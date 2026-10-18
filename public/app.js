const $ = (id) => document.getElementById(id);
const gate = $('gate'), app = $('app'), form = $('login'), error = $('gate-err');
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`;
let socket, localStream = null, broadcaster = false, loginBusy = false;
const peerConnections = new Map();

function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function showError(text) { error.textContent = text || ''; }
function pcConfig() { return { iceServers: [] }; }
function showVideo(stream) { const video = $('preview'); video.srcObject = stream; video.muted = broadcaster; video.hidden = false; $('btn-audio').hidden = broadcaster; video.play().catch(() => { if (!broadcaster) $('btn-audio').hidden = false; }); $('placeholder').hidden = true; }
function closePeers() { for (const pc of peerConnections.values()) pc.close(); peerConnections.clear(); }
function setLive(live, host) { $('badge').textContent = live ? `ao vivo${host ? ` · ${host}` : ''}` : 'offline'; $('badge').classList.toggle('on', live); $('live-tag').hidden = !live; if (!live && !broadcaster) { $('placeholder').hidden = false; $('preview').hidden = true; } }

async function makeOffer(peerId) {
  if (!localStream) return;
  const pc = new RTCPeerConnection(pcConfig()); peerConnections.set(peerId, pc);
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  for (const sender of pc.getSenders()) { const parameters = sender.getParameters(); parameters.degradationPreference = 'maintain-framerate'; parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}]; parameters.encodings[0].maxBitrate = sender.track.kind === 'video' ? 8000000 : 128000; parameters.encodings[0].maxFramerate = 60; try { await sender.setParameters(parameters); } catch {} }
  pc.onicecandidate = (event) => { if (event.candidate) send({ type: 'rtc-ice', target: peerId, candidate: event.candidate }); };
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer); send({ type: 'rtc-offer', target: peerId, sdp: pc.localDescription });
}
async function receiveOffer(message) {
  closePeers(); const pc = new RTCPeerConnection(pcConfig()); peerConnections.set('host', pc);
  pc.ontrack = (event) => { const receiver = event.receiver; if (receiver) { receiver.playoutDelayHint = 0; receiver.jitterBufferTarget = 0; } showVideo(event.streams[0]); };
  pc.onicecandidate = (event) => { if (event.candidate) send({ type: 'rtc-ice', candidate: event.candidate }); };
  await pc.setRemoteDescription(message.sdp); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); send({ type: 'rtc-answer', sdp: pc.localDescription });
}
async function startCapture() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1280, max: 1920 } }, audio: $('audio').checked });
    showVideo(localStream); $('preview').muted = true; $('btn-audio').hidden = true; $('btn-start').disabled = true; $('btn-stop').disabled = false;
    localStream.getVideoTracks()[0].addEventListener('ended', stopCapture);
  } catch (err) { send({ type: 'release' }); $('share-hint').textContent = err.name === 'AbortError' ? 'Compartilhamento cancelado.' : 'Não foi possível compartilhar esta tela.'; }
}
function stopCapture() { if (localStream) localStream.getTracks().forEach((track) => track.stop()); localStream = null; broadcaster = false; closePeers(); $('preview').srcObject = null; $('preview').hidden = true; $('btn-start').disabled = false; $('btn-stop').disabled = true; send({ type: 'rtc-stop' }); send({ type: 'stop' }); send({ type: 'release' }); }

function connect() {
  socket = new WebSocket(wsUrl);
  socket.onopen = () => send({ type: 'login', user: $('in-name').value, pass: $('in-pass').value });
  socket.onmessage = async ({ data }) => { let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'login-fail') { loginBusy = false; form.querySelector('button[type="submit"]').disabled = false; localStorage.removeItem('telalive-login'); showError(m.reason); return; }
    if (m.type === 'login-ok') { loginBusy = false; form.querySelector('button[type="submit"]').disabled = false; if ($('remember-login').checked) localStorage.setItem('telalive-login', JSON.stringify({ user: m.user, pass: $('in-pass').value })); gate.hidden = true; app.hidden = false; $('me-name').textContent = m.user; $('me-role').textContent = m.papel; $('share-hint').textContent = m.papel === 'viewer' ? 'Você está como espectador.' : 'Você pode compartilhar sua tela.'; return; }
    if (m.type === 'state') { $('host-panel').hidden = !m.podeTransmitir; $('count').textContent = m.list.length; const canManage = m.papel === 'admin' || m.papel === 'host'; $('roster').innerHTML = m.list.map((u) => `<li><span>${u.name} <small>${u.papel}${u.transmitindo ? ' · transmitindo' : ''}</small></span>${canManage ? `<button class="permission-btn ${u.podeTransmitir ? 'allowed' : ''}" data-user="${u.name}" data-value="${u.podeTransmitir ? 'false' : 'true'}">${u.podeTransmitir ? 'Sim' : 'Não'}</button>` : ''}</li>`).join(''); setLive(m.live, m.aoVivo); return; }
    if (m.type === 'you-are-broadcaster') { broadcaster = true; send({ type: 'start' }); return; }
    if (m.type === 'rtc-request' && broadcaster) { await makeOffer(m.peerId); return; }
    if (m.type === 'rtc-offer' && !broadcaster) { await receiveOffer(m); return; }
    if (m.type === 'rtc-answer' && broadcaster) { const pc = peerConnections.get(m.target); if (pc) await pc.setRemoteDescription(m.sdp); return; }
    if (m.type === 'rtc-ice') { const pc = broadcaster ? peerConnections.get(m.target) : peerConnections.get('host'); if (pc && m.candidate) try { await pc.addIceCandidate(m.candidate); } catch {} return; }
    if (m.type === 'rtc-stop') { closePeers(); $('preview').srcObject = null; $('preview').hidden = true; $('btn-audio').hidden = true; $('placeholder').hidden = false; return; }
    if (m.type === 'status') { setLive(m.live, m.host); if (!m.live && !broadcaster) { $('preview').srcObject = null; $('preview').hidden = true; } return; }
    if (m.type === 'denied' || m.type === 'notice') $('share-hint').textContent = m.reason || m.text;
    if (m.type === 'kicked') { stopCapture(); socket.close(); app.hidden = true; gate.hidden = false; showError('Você foi expulso da sala.'); }
  };
  socket.onclose = () => { loginBusy = false; form.querySelector('button[type="submit"]').disabled = false; closePeers(); if (!app.hidden) $('share-hint').textContent = 'Conexão encerrada.'; };
}

form.addEventListener('submit', (event) => { event.preventDefault(); if (loginBusy || (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN))) return; loginBusy = true; form.querySelector('button[type="submit"]').disabled = true; showError(''); if ($('remember-login').checked) localStorage.setItem('telalive-login', JSON.stringify({ user: $('in-name').value, pass: $('in-pass').value })); else localStorage.removeItem('telalive-login'); socket = null; connect(); });
$('btn-start').addEventListener('click', async () => { await startCapture(); if (localStream) send({ type: 'take-broadcast' }); });
$('btn-stop').addEventListener('click', stopCapture);
$('btn-logout').addEventListener('click', () => { stopCapture(); localStorage.removeItem('telalive-login'); if (socket && socket.readyState < WebSocket.CLOSING) socket.close(); gate.hidden = false; app.hidden = true; $('in-pass').value = ''; showError(''); });
$('btn-audio').addEventListener('click', () => { const video = $('preview'); video.muted = false; video.play().then(() => { $('btn-audio').hidden = true; }).catch(() => {}); });
const screenEl = document.querySelector('.screen');
$('btn-fullscreen').addEventListener('click', () => { screenEl.classList.toggle('mobile-fullscreen'); $('btn-fullscreen').textContent = screenEl.classList.contains('mobile-fullscreen') ? 'Sair da tela cheia' : 'Tela cheia'; });
$('roster').addEventListener('click', (event) => { const button = event.target.closest('.permission-btn'); if (button) send({ type: 'set-permission', name: button.dataset.user, value: button.dataset.value === 'true' }); });
window.addEventListener('beforeunload', stopCapture);
$('host-panel').hidden = true; $('live-tag').hidden = true; $('preview').hidden = true;
try { const saved = JSON.parse(localStorage.getItem('telalive-login') || 'null'); if (saved?.user && saved?.pass) { $('in-name').value = saved.user; $('in-pass').value = saved.pass; loginBusy = true; form.querySelector('button[type="submit"]').disabled = true; connect(); } } catch { localStorage.removeItem('telalive-login'); }
