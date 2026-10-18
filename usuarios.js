import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'contas.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADMIN_PADRAO = { nome: 'gilmar', senha: 'gil18092010' };

const hash = (p) => crypto.createHash('sha256').update('telalive::' + p).digest('hex').slice(0, 32);

function load() {
  if (!fs.existsSync(FILE)) {
    let admin = ADMIN_PADRAO;
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (config.admin?.nome && config.admin?.senha) admin = { nome: String(config.admin.nome).toLowerCase(), senha: String(config.admin.senha) };
    } catch { /* usa os dados padrão */ }
    const db = {
      contaAdmin: admin.nome,
      usuarios: {
        [admin.nome]: {
          senha: hash(admin.senha), papel: 'admin',
          podeTransmitir: true, ativo: true, criadoEm: new Date().toISOString()
        }
      }
    };
    save(db);
    console.log(`\n  Criei contas.json com o admin "${ADMIN_PADRAO.nome}".\n`);
    return db;
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
const save = (db) => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const [, , cmd, ...args] = process.argv;
const db = load();

switch (cmd) {
  case 'add': {
    const [nome, senha, tipo] = args;
    if (!nome || !senha) { console.log('uso: node usuarios.js add <nome> <senha> [transmitir]'); break; }
    const k = nome.toLowerCase();
    if (db.usuarios[k]) { console.log(`"${nome}" ja existe.`); break; }
    const papel = tipo === 'transmitir' || tipo === 'host' ? 'host' : 'viewer';
    db.usuarios[k] = { senha: hash(senha), papel,
                       podeTransmitir: papel === 'host', ativo: true, criadoEm: new Date().toISOString() };
    save(db);
    console.log(`+ ${nome} criada.`); break;
  }
  case 'pass': {
    const [nome, senha] = args;
    const u = db.usuarios[nome?.toLowerCase()];
    if (!u) { console.log('nao achei essa conta.'); break; }
    u.senha = hash(senha); save(db);
    console.log(`senha de ${nome} trocada.`); break;
  }
  case 'block': case 'unblock': {
    const u = db.usuarios[args[0]?.toLowerCase()];
    if (!u) { console.log('nao achei.'); break; }
    u.ativo = cmd === 'unblock'; save(db);
    console.log(`${args[0]} ${u.ativo ? 'liberado' : 'bloqueado'}.`); break;
  }
  case 'allow': case 'deny': {
    const u = db.usuarios[args[0]?.toLowerCase()];
    if (!u) { console.log('nao achei.'); break; }
    u.podeTransmitir = cmd === 'allow'; save(db);
    console.log(`${args[0]} ${u.podeTransmitir ? 'PODE' : 'NAO PODE'} transmitir.`); break;
  }
  case 'remove': {
    const k = args[0]?.toLowerCase();
    if (!db.usuarios[k]) { console.log('nao achei.'); break; }
    delete db.usuarios[k]; save(db);
    console.log(`- ${args[0]} removida.`); break;
  }
  case 'list': {
    console.log('\n  CONTA        PAPEL   TRANSMITIR  ATIVO');
    for (const [n, u] of Object.entries(db.usuarios))
      console.log(`  ${n.padEnd(12)} ${u.papel.padEnd(7)} ${String(u.podeTransmitir).padEnd(11)} ${u.ativo}`);
    console.log('');
    break;
  }
  default:
    console.log(`
  node usuarios.js add <nome> <senha> [transmitir]   cria conta
  node usuarios.js pass <nome> <senha>               troca senha
  node usuarios.js allow|deny <nome>                 libera/nega transmitir
  node usuarios.js block|unblock <nome>              bane/desbane
  node usuarios.js remove <nome>                     apaga
  node usuarios.js list                              mostra tudo
`);
}
