import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const CONTAS_FILE = path.join(__dirname, 'contas.json');
const LOG_FILE = path.join(__dirname, 'log-acessos.csv');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADMIN_PADRAO = { nome: 'gilmar', senha: 'gil18092010' };
const hash = (senha) => crypto.createHash('sha256').update(`telalive::${senha}`).digest('hex').slice(0, 32);

function initialAdmin() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const nome = String(config.admin?.nome || '').trim().toLowerCase();
    const senha = String(config.admin?.senha || '');
    if (nome && senha) return { nome, senha };
  } catch { /* config.json é opcional */ }
  return ADMIN_PADRAO;
}
function defaultDb() {
  const admin = initialAdmin();
  return { contaAdmin: admin.nome, usuarios: {
    [admin.nome]: { senha: hash(admin.senha), papel: 'admin', podeTransmitir: true, ativo: true, criadoEm: new Date().toISOString() }
  }};
}
function saveDb(database) { fs.writeFileSync(CONTAS_FILE, JSON.stringify(database, null, 2) + '\n', 'utf8'); }
function loadDb() {
  if (!fs.existsSync(CONTAS_FILE)) { const database = defaultDb(); saveDb(database); console.log(`[*] Criei contas.json com o administrador "${ADMIN_PADRAO.nome}".`); return database; }
  try {
    const database = JSON.parse(fs.readFileSync(CONTAS_FILE, 'utf8'));
    if (!database.usuarios || typeof database.usuarios !== 'object') throw new Error('usuarios inválidos');
    return database;
  } catch (error) { console.log(`[!] contas.json inválido (${error.message}); usando a conta administrativa padrão.`); const database = defaultDb(); saveDb(database); return database; }
}
let dbCache = { mtime: 0, value: null };
function db() { const stat = fs.statSync(CONTAS_FILE); if (!dbCache.value || stat.mtimeMs !== dbCache.mtime) dbCache = { mtime: stat.mtimeMs, value: loadDb() }; return dbCache.value; }
function saveAndRefresh(database) { saveDb(database); dbCache = { mtime: fs.statSync(CONTAS_FILE).mtimeMs, value: database }; }

const CSV_HEADER = 'Data/Hora,Conta,IP,Porta,Papel,Entrou,Observacao,Tempo online\n';
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function log({ conta, ip, porta, papel, entrou, obs = '', tempo = '' }) {
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const row = [hora, conta, ip, porta, papel, entrou, obs, tempo].map(csvCell).join(',') + '\n';
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, CSV_HEADER, 'utf8');
  fs.appendFile(LOG_FILE, row, 'utf8', (error) => { if (error) console.log('[log]', error.message); });
  console.log(`  ${entrou === 'sim' ? '+' : 'x'} ${conta} @${ip}:${porta} ${papel}${obs ? ` | ${obs}` : ''}`);
}

const attempts = new Map();
function blocked(ip, limit = 8) { const recent = (attempts.get(ip) || []).filter((time) => Date.now() - time < 60_000); attempts.set(ip, recent); return recent.length >= limit; }
function failedAttempt(ip) { attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]); }

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });
let broadcaster = null;
let latestFrame = null;
let rtcSequence = 0;
const clients = new Map();
const send = (ws, value) => { if (ws?.readyState === 1) ws.send(JSON.stringify(value)); };
const broadcast = (value, except) => { const data = JSON.stringify(value); for (const client of wss.clients) if (client !== except && client.readyState === 1) client.send(data); };
const ipOf = (req) => (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.socket.remoteAddress || '?').replace('::ffff:', '').replace('::1', '127.0.0.1'));
const elapsed = (since) => { const seconds = Math.round((Date.now() - since) / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`; };
function sendState(ws) { const me = clients.get(ws); send(ws, { type: 'state', live: !!broadcaster, aoVivo: broadcaster ? clients.get(broadcaster)?.name : null, podeTransmitir: !!me?.podeTransmitir, papel: me?.papel, list: [...clients.values()].map((user) => ({ name: user.name, papel: user.papel, podeTransmitir: user.podeTransmitir, transmitindo: broadcaster ? clients.get(broadcaster)?.name === user.name : false })) }); }
function pushState() { for (const client of clients.keys()) sendState(client); }

wss.on('connection', (ws, req) => {
  const ip = ipOf(req), porta = req.socket.remotePort;
  let authenticated = false;
  const timer = setTimeout(() => { if (!authenticated) ws.close(4001, 'timeout'); }, 25_000);
  ws.on('message', (raw) => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'login') {
      const database = db(), name = String(message.user || '').trim().toLowerCase().slice(0, 24);
      if (!name) return send(ws, { type: 'login-fail', reason: 'Informe o nome da conta.' });
      if (blocked(ip)) { log({ conta: name, ip, porta, papel: '-', entrou: 'nao', obs: 'IP bloqueado por tentativas' }); return send(ws, { type: 'login-fail', reason: 'Muitas tentativas. Aguarde 1 minuto.' }); }
      const user = database.usuarios[name];
      if (!user) { failedAttempt(ip); log({ conta: name, ip, porta, papel: '-', entrou: 'nao', obs: 'conta inexistente' }); return send(ws, { type: 'login-fail', reason: 'Conta não existe.' }); }
      if (!user.ativo) return send(ws, { type: 'login-fail', reason: 'Conta bloqueada pelo administrador.' });
      if (user.senha !== hash(String(message.pass || ''))) { failedAttempt(ip); log({ conta: name, ip, porta, papel: user.papel, entrou: 'nao', obs: 'senha errada' }); return send(ws, { type: 'login-fail', reason: 'Senha errada.' }); }
      clearTimeout(timer); authenticated = true; attempts.delete(ip); clients.set(ws, { name, papel: user.papel, podeTransmitir: !!user.podeTransmitir, joined: Date.now(), ip, porta, peerId: String(++rtcSequence) });
      log({ conta: name, ip, porta, papel: user.papel, entrou: 'sim' }); send(ws, { type: 'login-ok', user: name, papel: user.papel, sala: database.contaAdmin }); if (latestFrame) send(ws, { type: 'frame', data: latestFrame }); if (broadcaster) send(broadcaster, { type: 'rtc-request', peerId: clients.get(ws).peerId }); return pushState();
    }
    const me = clients.get(ws); if (!me) return;
    if (message.type === 'rtc-offer' && ws === broadcaster) { const target = [...clients.entries()].find(([, user]) => user.peerId === message.target)?.[0]; if (target) send(target, { type: 'rtc-offer', sdp: message.sdp }); return; }
    if (message.type === 'rtc-answer' && ws !== broadcaster && broadcaster) { send(broadcaster, { type: 'rtc-answer', target: me.peerId, sdp: message.sdp }); return; }
    if (message.type === 'rtc-ice') { if (ws === broadcaster) { const target = [...clients.entries()].find(([, user]) => user.peerId === message.target)?.[0]; if (target) send(target, { type: 'rtc-ice', candidate: message.candidate }); } else if (broadcaster) send(broadcaster, { type: 'rtc-ice', target: me.peerId, candidate: message.candidate }); return; }
    if (message.type === 'rtc-stop' && ws === broadcaster) { broadcast({ type: 'rtc-stop' }, ws); return; }
    if (message.type === 'audio' && ws === broadcaster && typeof message.data === 'string') { broadcast({ type: 'audio', data: message.data, mime: message.mime }, ws); return; }
    if (message.type === 'audio-stop' && ws === broadcaster) { broadcast({ type: 'audio-stop' }, ws); return; }
    if (message.type === 'take-broadcast') { if (!me.podeTransmitir) return send(ws, { type: 'denied', reason: 'Seu perfil só pode assistir.' }); if (broadcaster && broadcaster !== ws) return send(ws, { type: 'denied', reason: `${clients.get(broadcaster)?.name} já está transmitindo.` }); broadcaster = ws; send(ws, { type: 'you-are-broadcaster' }); broadcast({ type: 'notice', text: `${me.name} assumiu a tela.` }); return pushState(); }
    if (message.type === 'start' && ws === broadcaster) { for (const [client, user] of clients) if (client !== ws) send(ws, { type: 'rtc-request', peerId: user.peerId }); broadcast({ type: 'status', live: true, host: me.name }); }
    if (message.type === 'frame' && ws === broadcaster && typeof message.data === 'string') { latestFrame = message.data; const data = JSON.stringify({ type: 'frame', data: latestFrame }); for (const client of clients.keys()) if (client !== broadcaster && client.readyState === 1 && client.bufferedAmount < 150000) client.send(data); }
    if (message.type === 'stop' && ws === broadcaster) { latestFrame = null; broadcast({ type: 'status', live: false }); }
    if (message.type === 'release' && ws === broadcaster) { broadcaster = null; latestFrame = null; broadcast({ type: 'status', live: false }); pushState(); }
    if (message.type === 'refresh') pushState();
    if (message.type === 'kick' && me.papel === 'admin') for (const [client, user] of clients) if (user.name === String(message.name).toLowerCase()) { send(client, { type: 'kicked' }); client.close(4002, 'expulso'); }
    if (message.type === 'set-permission' && (me.papel === 'admin' || me.papel === 'host')) { const database = db(), target = database.usuarios[String(message.name || '').toLowerCase()]; if (target) { target.podeTransmitir = !!message.value; saveAndRefresh(database); for (const user of clients.values()) if (user.name === String(message.name).toLowerCase()) user.podeTransmitir = target.podeTransmitir; broadcast({ type: 'notice', text: `${target === database.usuarios[me.name] ? 'Sua' : String(message.name)} permissão de transmissão: ${target.podeTransmitir ? 'Sim' : 'Não'}.` }); pushState(); } }
    if (message.type === 'create-user' && me.papel === 'admin') { const database = db(), name = String(message.name || '').trim().toLowerCase(); if (!name || !message.pass) return; if (database.usuarios[name]) return send(ws, { type: 'notice', text: `${name} já existe.` }); const papel = message.papel === 'host' ? 'host' : 'viewer'; database.usuarios[name] = { senha: hash(String(message.pass)), papel, podeTransmitir: papel === 'host', ativo: true, criadoEm: new Date().toISOString() }; saveAndRefresh(database); send(ws, { type: 'notice', text: `Conta ${name} criada.` }); }
  });
  ws.on('close', () => { clearTimeout(timer); const me = clients.get(ws); if (!me) return; clients.delete(ws); log({ conta: me.name, ip: me.ip, porta: me.porta, papel: me.papel, entrou: 'sim', obs: 'saiu', tempo: elapsed(me.joined) }); if (ws === broadcaster) { broadcaster = null; latestFrame = null; broadcast({ type: 'status', live: false }); } pushState(); });
});

server.listen(PORT, '0.0.0.0', () => { console.log(`\n  Contas em contas.json · log em log-acessos.csv`); console.log(`  Admin: ${db().contaAdmin}`); console.log(`  Local: http://localhost:${PORT}`); for (const network of Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal)) console.log(`  Rede:  http://${network.address}:${PORT}`); });
