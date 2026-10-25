// Opt-in experiment for a dedicated idle desktop thread or an ephemeral test thread.
// Does not implement ASR. Sends only a synthetic WAV to the signed-in Codex runtime.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
let threadId = value('--thread');
const ephemeral = args.includes('--ephemeral');
const mode = value('--mode');
const queueTarget = args.includes('--queue-target') ? value('--queue-target') : undefined;
if (args.includes('--queue-target') && !queueTarget) throw new Error('--queue-target requires a UUID');
if (queueTarget && (!ephemeral || mode !== 'webrtc' || !/^[0-9a-f-]{36}$/i.test(queueTarget))) {
  throw new Error('--queue-target UUID requires --ephemeral --mode webrtc');
}
if (!args.includes('--confirm-test-thread') || (!ephemeral && (!args.includes('--thread') ||
    !/^[0-9a-f-]{36}$/i.test(threadId))) || !['attachment', 'realtime', 'webrtc'].includes(mode) || !args.includes('--audio')) {
  throw new Error('Required: (--thread UUID | --ephemeral) --mode attachment|realtime|webrtc --audio WAV --confirm-test-thread');
}
if (ephemeral && args.includes('--thread')) throw new Error('Choose an existing thread OR an ephemeral thread');
const audioPath = resolve(value('--audio'));
const wav = readFileSync(audioPath);
if (wav.length > 5 * 1024 * 1024 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
  throw new Error('Expected a synthetic RIFF/WAV under 5 MiB');
}
let pcm, format;
for (let offset = 12; offset + 8 <= wav.length;) {
  const kind = wav.toString('ascii', offset, offset + 4), length = wav.readUInt32LE(offset + 4), start = offset + 8;
  if (start + length > wav.length) throw new Error('Truncated WAV');
  if (kind === 'fmt ') {
    if (length < 16) throw new Error('Invalid WAV format');
    format = { codec: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
      sampleRate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
  }
  if (kind === 'data') pcm = wav.subarray(start, start + length);
  offset = start + length + (length % 2);
}
if (!pcm || format?.codec !== 1 || format.channels !== 1 || format.sampleRate !== 24000 || format.bits !== 16) {
  throw new Error('Expected 24 kHz mono signed PCM16 WAV');
}
const child = spawn(process.env.MIRTAR_CODEX_BIN || 'codex', ['app-server', '--listen', 'stdio://'],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map(), notifications = [];
let nextId = 0, stderrBytes = 0, ownedTurnId, realtimeRequested = false, rtcSdp, browser, rtcServer, browserProfile;
let baselineTurnIds;
let pendingUserText = '', lastUserTranscriptAt = 0, playbackEndedAt = 0;
const completeUserParts = [];
child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
const lines = createInterface({ input: child.stdout });
function failPending(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
child.on('error', failPending);
child.on('exit', code => failPending(new Error(`Codex exited: ${code}`)));
child.stdin.on('error', failPending);
lines.on('line', line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.id !== undefined && m.method) {
    child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'Validation cannot provide approvals or credentials' } }) + '\n');
  } else if (m.method && m.params?.threadId === threadId) {
    if (m.method === 'thread/realtime/sdp') rtcSdp = m.params.sdp;
    // Keep a bounded summary. Never retain audio or opaque realtime items in logs.
    const entry = { method: m.method };
    if (m.method === 'item/agentMessage/delta') entry.text = m.params.delta;
    if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') entry.text = m.params.item.text;
    if (m.method === 'turn/completed') { entry.turnId = m.params.turn?.id; entry.status = m.params.turn?.status; entry.error = m.params.turn?.error; }
    if (m.method === 'thread/realtime/error' || m.method === 'error') entry.error = m.params.error ?? m.params.message;
    if (/transcript/.test(m.method)) {
      entry.role = m.params.role;
      entry.transcript = m.params.delta ?? m.params.text ?? m.params.transcript;
      if (m.params.role === 'user') {
        lastUserTranscriptAt = Date.now();
        if (m.method === 'thread/realtime/transcript/delta') pendingUserText += m.params.delta;
        if (m.method === 'thread/realtime/transcript/done') {
          completeUserParts.push(m.params.text);
          pendingUserText = '';
        }
      }
    }
    if (notifications.length >= 3000) notifications.shift();
    notifications.push(entry);
  }
});
function request(method, params = {}, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timed out`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
function emit(check, result) { console.log(JSON.stringify({ check, result })); }
async function testWebrtc() {
  // Isolated headless Edge is used only as a WebRTC/media engine. No personal browser
  // profile, microphone access, installed extension, credential, or npm package is used.
  const prefix = '/' + randomUUID();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const page = `<!doctype html><meta charset="utf-8"><script>
  (async()=>{
    const report = data => fetch('${prefix}/done',{method:'POST',body:JSON.stringify(data)});
    let pc;
    try {
      const ac=new AudioContext({sampleRate:24000}); await ac.resume();
      const data=await (await fetch('${prefix}/input.wav')).arrayBuffer();
      const decoded=await ac.decodeAudioData(data), dest=ac.createMediaStreamDestination();
      // Feed actual silent samples after the clip. Merely waiting after a source
      // stops does not guarantee that the remote VAD receives a silence tail.
      const audio=ac.createBuffer(decoded.numberOfChannels,decoded.length+decoded.sampleRate*2,decoded.sampleRate);
      for(let c=0;c<decoded.numberOfChannels;c++)audio.copyToChannel(decoded.getChannelData(c),c);
      const source=ac.createBufferSource();source.buffer=audio;source.connect(dest);
      pc=new RTCPeerConnection(); for(const t of dest.stream.getTracks())pc.addTrack(t,dest.stream);
      const dc=pc.createDataChannel('oai-events'), eventTypes={}, transcripts=[];
      dc.onmessage=e=>{try{const m=JSON.parse(e.data);eventTypes[m.type]=(eventTypes[m.type]||0)+1;
        if(/transcript.*(done|completed)$/.test(m.type||'')&&typeof m.transcript==='string')transcripts.push(m.transcript);
      }catch{}};
      await pc.setLocalDescription(await pc.createOffer());
      const signal=await fetch('${prefix}/offer',{method:'POST',body:pc.localDescription.sdp});
      const answer=await signal.json(); if(!signal.ok)throw Error(answer.error||'Signaling failed');
      await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebRTC connection timeout')),15000);
        const check=()=>{if(pc.connectionState==='connected'){clearTimeout(timer);resolve();}
          if(pc.connectionState==='failed'){clearTimeout(timer);reject(Error('WebRTC connection failed'));}};
        pc.onconnectionstatechange=check;check();});
      await fetch('${prefix}/commit',{method:'POST'});
      const ended=new Promise(r=>{source.onended=r;}); source.start(); await ended;
      await fetch('${prefix}/input-ended',{method:'POST'});
      if(${!!queueTarget}){
        const deadline=performance.now()+25000;let finalized=false;
        while(performance.now()<deadline){const s=await(await fetch('${prefix}/input-status')).json();
          if(s.ready){finalized=true;break;}await new Promise(r=>setTimeout(r,250));}
        if(!finalized)throw Error('Native input tail was not finalized; no request will be queued');
      }else await new Promise(r=>setTimeout(r,8000));
      await report({connected:true,eventTypes,transcripts}); await ac.close();
    }catch(e){await report({error:String(e.message||e)});}finally{if(pc)pc.close();}
  })();</script>`;
  rtcServer = createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith(prefix + '/')) { res.writeHead(404).end(); return; }
      if (req.method === 'GET' && req.url === prefix + '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(page); return;
      }
      if (req.method === 'GET' && req.url === prefix + '/input.wav') {
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }).end(wav); return;
      }
      if (req.method === 'GET' && req.url === prefix + '/input-status') {
        const ready = !!playbackEndedAt && completeUserParts.length > 0 && !pendingUserText.trim() &&
          Date.now() - lastUserTranscriptAt >= 1500 && Date.now() - playbackEndedAt >= 1500;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ready })); return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 100000) throw new Error('Request too large'); }
      if (req.url === prefix + '/offer') {
        realtimeRequested = true;
        // Default v1 was rejected by AVAS; the generated protocol also supports v3.
        // No remote track is attached to speakers; playback remains untested.
        await request('thread/realtime/start', { threadId, version: 'v3', outputModality: 'audio',
          ...(queueTarget ? { prompt: 'You are a native Codex voice input terminal. Transcribe the spoken request accurately and acknowledge only Received. Do not execute, delegate, or call any tools. A separate native Codex task will execute the transcribed request.' } : {}),
          transport: { type: 'webrtc', sdp: body } }, 30000);
        const deadline = Date.now() + 30000;
        while (!rtcSdp && !notifications.some(n => /thread\/realtime\/(error|closed)/.test(n.method)) && Date.now() < deadline) await delay(100);
        if (!rtcSdp) {
          const error = notifications.find(n => n.method === 'thread/realtime/error')?.error || 'No WebRTC SDP answer';
          emit('webrtc_signaling', { ok: false, error });
          res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error })); return;
        }
        emit('webrtc_signaling', { ok: true, receivedSdp: true });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sdp: rtcSdp })); return;
      }
      if (req.url === prefix + '/commit') { emit('input_commit', { audioNotSentBeforeThisPoint: true }); res.end('{}'); return; }
      if (req.url === prefix + '/input-ended') { playbackEndedAt = Date.now(); res.end('{}'); return; }
      if (req.url === prefix + '/done') { finish(JSON.parse(body)); res.end('{}'); return; }
      res.writeHead(404).end();
    } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => rtcServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${rtcServer.address().port}${prefix}/`;
  browserProfile = resolve('.private/codex-validation/rtc-profile-' + randomUUID());
  browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${browserProfile}`, url,
  ], { stdio: 'ignore', windowsHide: true });
  browser.on('error', e => finish({ error: e.message }));
  const outcome = await Promise.race([done, delay(75000, null, { ref: false }).then(() => ({ error: 'WebRTC experiment timed out' }))]);
  emit('webrtc_result', outcome);
  if (queueTarget) {
    await request('thread/realtime/stop', { threadId }, 5000);
    realtimeRequested = false;
    await delay(300);
    const utterances = completeUserParts;
    const text = utterances.join('\n').trim();
    emit('native_input_transcript', { text, utterances: utterances.length, hasUnfinalizedTail: !!pendingUserText.trim() });
    if (outcome.error || !text || pendingUserText.trim()) throw new Error('No complete native user transcript; nothing queued');
    // This executable fixture must preserve its final constraints as well as the
    // arithmetic request. Refuse partial recognition before any queue mutation.
    if (!/do not change any files/i.test(text) || !/word completed/i.test(text)) throw new Error('Synthetic fixture tail missing; nothing queued');
    if (notifications.some(n => n.method === 'turn/started')) throw new Error('Voice frontend started an unexpected Agent turn; nothing queued');
    const clientUserMessageId = randomUUID(), submittedAt = Date.now();
    const queued = await request('thread/queue/add', { threadId: queueTarget, clientUserMessageId, input: [{ type: 'text', text }] });
    emit('thread/queue/add', { accepted: !!queued.queuedSubmission?.id, clientIdMatches: queued.queuedSubmission?.clientUserMessageId === clientUserMessageId,
      queuedSubmissionId: queued.queuedSubmission?.id, elapsedMs: Date.now() - submittedAt });
    let matchingTurn, firstObservedAfterMs;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const page = await request('thread/turns/list', { threadId: queueTarget, limit: 5, sortDirection: 'desc', itemsView: 'full' });
      matchingTurn = page.data.find(t => !baselineTurnIds.has(t.id) && t.items.some(i => i.type === 'userMessage' &&
        (i.clientId === clientUserMessageId || i.content?.some(c => c.type === 'text' && c.text === text))));
      if (matchingTurn && firstObservedAfterMs === undefined) firstObservedAfterMs = Date.now() - submittedAt;
      // A separate process may hydrate an unfinished rollout as "interrupted".
      // Do not treat that disk snapshot as the live desktop owner's terminal state.
      if (matchingTurn?.status === 'completed' && matchingTurn.completedAt != null) break;
      await delay(1000);
    }
    const commands = matchingTurn?.items.filter(i => i.type === 'commandExecution').map(i => ({ command: i.command, status: i.status, exitCode: i.exitCode, output: i.aggregatedOutput }));
    const replies = matchingTurn?.items.filter(i => i.type === 'agentMessage').map(i => ({ phase: i.phase, text: i.text }));
    const actualExecution = commands?.some(c => c.exitCode === 0 && /692257/.test(c.output || ''));
    const correctReply = replies?.some(r => r.phase === 'final_answer' && /692257/.test(r.text) && /completed/i.test(r.text));
    emit('desktop_agent_result', { turnId: matchingTurn?.id, status: matchingTurn?.status, commands, replies, actualExecution, correctReply,
      firstObservedAfterMs, elapsedMs: Date.now() - submittedAt });
    if (matchingTurn?.status !== 'completed' || !actualExecution || !correctReply) process.exitCode = 1;
    return;
  }
  const transcripts = notifications.filter(n => n.method === 'thread/realtime/transcript/done');
  const assistantText = transcripts.filter(n => n.role === 'assistant').map(n => n.transcript).join(' ');
  const recognized = /\bcobalt\s+seven\b/i.test(assistantText);
  emit('audio_recognition', { recognized, expectedOnlyInAudio: true, transcripts });
  if (outcome.error || !recognized) process.exitCode = 1;
}
try {
  emit('experiment', { mode, ephemeral, transport: 'separate-stdio-process', startedAt: new Date().toISOString(), format, durationSeconds: pcm.length / 48000 });
  await request('initialize', { clientInfo: { name: 'mirtar_audio_validation', version: '0.0.1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  if (queueTarget) {
    const target = await request('thread/read', { threadId: queueTarget, includeTurns: false });
    if (target.thread?.name !== 'MirTar 验证') throw new Error('Queue target must be the dedicated MirTar 验证 thread');
    const page = await request('thread/turns/list', { threadId: queueTarget, limit: 5, sortDirection: 'desc', itemsView: 'notLoaded' });
    baselineTurnIds = new Set(page.data.map(t => t.id));
    emit('queue_target', { confirmedTestThread: true, baselineTurns: baselineTurnIds.size });
  }
  const instructions = 'This is an isolated audio input/output test. Do not use tools, read files, run commands, modify anything, or delegate work. Answer the audio request directly; if audio cannot be heard, say so. Do not guess its content.';
  let resumed;
  if (ephemeral) {
    resumed = await request('thread/start', { ephemeral: true, cwd: resolve('.private/codex-validation'),
      sandbox: 'read-only', approvalPolicy: 'never', baseInstructions: instructions, developerInstructions: instructions });
    threadId = resumed.thread.id;
    emit('thread/start', { ephemeral: true, model: resumed.model, status: resumed.thread.status });
  } else {
    const before = await request('thread/read', { threadId, includeTurns: false });
    emit('thread/read', { nameMatches: /MirTar.*验证/.test(before.thread?.name || ''), status: before.thread?.status });
    if (!/MirTar.*验证/.test(before.thread?.name || '')) throw new Error('Refusing input: thread must be named MirTar 验证');
    if (before.thread?.status?.type === 'active') throw new Error('Refusing input to active thread');
    resumed = await request('thread/resume', { threadId, excludeTurns: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: instructions });
    emit('thread/resume', { sameThread: resumed.thread?.id === threadId, model: resumed.model, status: resumed.thread?.status });
  }
  if (mode === 'attachment') {
    const submittedAt = Date.now();
    const r = await request('turn/start', { threadId, input: [{ type: 'localAudio', path: audioPath }], environments: [] });
    ownedTurnId = r.turn?.id;
    emit('turn/start', { accepted: !!ownedTurnId, status: r.turn?.status, elapsedMs: Date.now() - submittedAt });
    const deadline = Date.now() + 45000;
    while (!notifications.some(n => n.method === 'turn/completed' && n.turnId === ownedTurnId) && Date.now() < deadline) await delay(200);
    const completed = notifications.find(n => n.method === 'turn/completed' && n.turnId === ownedTurnId);
    emit('turn/completed', completed || { timedOut: true });
    const replies = notifications.filter(n => n.method === 'item/completed' && n.text).map(n => n.text);
    emit('reply', replies);
    const recognized = replies.some(text => /\bcobalt\s+seven\b/i.test(text));
    emit('audio_recognition', { recognized, expectedOnlyInAudio: true });
    if (!recognized) process.exitCode = 1;
    if (!completed || completed.status !== 'completed') process.exitCode = 1;
    else ownedTurnId = undefined;
  } else if (mode === 'webrtc') {
    await testWebrtc();
  } else {
    realtimeRequested = true;
    const r = await request('thread/realtime/start', { threadId, outputModality: 'text', transport: { type: 'websocket' } }, 30000);
    emit('thread/realtime/start', { responseKeys: Object.keys(r) });
    const deadline = Date.now() + 15000;
    while (!notifications.some(n => /thread\/realtime\/(started|error|closed)/.test(n.method)) && Date.now() < deadline) await delay(100);
    if (!notifications.some(n => n.method === 'thread/realtime/started') || notifications.some(n => n.method === 'thread/realtime/error')) {
      throw new Error('Realtime did not become ready; no audio sent');
    }
    emit('input_commit', { totalBytes: pcm.length, audioNotSentBeforeThisPoint: true });
    // Entire clip was buffered before commit. Feed 20 ms PCM frames after commit.
    for (let offset = 0; offset < pcm.length; offset += 960) {
      if (notifications.some(n => /thread\/realtime\/(error|closed)/.test(n.method))) throw new Error('Realtime closed during input');
      const frame = pcm.subarray(offset, offset + 960);
      await request('thread/realtime/appendAudio', { threadId, audio: {
        data: frame.toString('base64'), sampleRate: 24000, numChannels: 1, samplesPerChannel: frame.length / 2,
      } });
      await delay(20);
    }
    // Give server-side end-of-speech detection a bounded tail after the clip.
    for (let i = 0; i < 50; i++) {
      await request('thread/realtime/appendAudio', { threadId, audio: {
        data: Buffer.alloc(960).toString('base64'), sampleRate: 24000, numChannels: 1, samplesPerChannel: 480,
      } });
      await delay(20);
    }
    await delay(10000);
  }
} catch (error) {
  emit('failure', { error: error.message.slice(0, 1000) }); process.exitCode = 1;
} finally {
  if (realtimeRequested) {
    try { await request('thread/realtime/stop', { threadId }, 5000); emit('thread/realtime/stop', { requested: true }); }
    catch (error) { emit('thread/realtime/stop', { error: error.message }); }
  }
  if (ownedTurnId) {
    try { await request('turn/interrupt', { threadId, turnId: ownedTurnId }, 5000); emit('cleanup', { interruptedOwnedTestTurn: true }); }
    catch (error) { emit('cleanup', { error: error.message }); }
  }
  emit('notifications', notifications);
  emit('stderrBytes', stderrBytes);
  if (browserProfile) {
    const cleanup = spawn('powershell.exe', ['-NoProfile', '-File', resolve(import.meta.dirname, 'Stop-TestBrowser.ps1'), '-ProfilePath', browserProfile],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let summary = '';
    cleanup.stdout.on('data', chunk => { summary += chunk; });
    const result = await new Promise(resolve => { cleanup.on('error', () => resolve(-1)); cleanup.on('exit', resolve); });
    emit('browser_cleanup', { exitCode: result, summary: summary.trim() });
    if (result !== 0) process.exitCode = 1;
  } else browser?.kill();
  rtcServer?.closeAllConnections();
  rtcServer?.close();
  failPending(new Error('Probe closed')); lines.close(); child.stdin.end(); child.kill();
}
