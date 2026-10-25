import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexRpc } from './rpc.ts';
import { pcm16kToWav24k } from '../protocol.ts';
import type { MediaHost, MediaHandle } from '../host/contracts.ts';

// Edge is an isolated WebRTC media engine; no microphone, personal profile,
// extension, ASR implementation or API key is used here.
export async function transcribeNative(bin: string, mediaHost: MediaHost, pcm: Buffer, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const rpc = new CodexRpc(bin);
  const prefix = '/' + randomUUID();
  const profile = resolve('.private/codex-validation/rtc-profile-' + randomUUID());
  await mkdir(profile, { recursive: true });
  let threadId = '', sdp = '', pendingText = '', lastTranscript = 0, endedAt = 0, unexpectedTurn = false;
  const utterances: string[] = [];
  const wav = pcm16kToWav24k(pcm);
  let finish!: (error?: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { finish = error => error ? reject(error) : resolve(); });
  // Attach immediately; an abort can arrive before the awaited race.
  finished.catch(() => {});
  const abort = () => finish(Error('input_cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  rpc.on('notification', (method: string, p: any) => {
    if (p.threadId !== threadId) return;
    if (method === 'thread/realtime/sdp') sdp = p.sdp;
    if (method === 'thread/realtime/error') finish(Error('native_voice_error'));
    if (method === 'turn/started') { unexpectedTurn = true; finish(Error('unexpected_voice_turn')); }
    if (p.role === 'user' && method === 'thread/realtime/transcript/delta') { pendingText += p.delta; lastTranscript = Date.now(); }
    if (p.role === 'user' && method === 'thread/realtime/transcript/done') {
      if (typeof p.text === 'string' && p.text.trim()) utterances.push(p.text);
      pendingText = ''; lastTranscript = Date.now();
    }
  });
  const ready = () => !!endedAt && utterances.length > 0 && !pendingText.trim() && !unexpectedTurn &&
    Date.now() - endedAt >= 2000 && Date.now() - lastTranscript >= 2000;
  const page = `<!doctype html><meta charset="utf-8"><script>
  (async()=>{let pc,ac;const post=(path,body='')=>fetch('${prefix}/'+path,{method:'POST',body});
  try{ac=new AudioContext({sampleRate:24000});await ac.resume();
    const decoded=await ac.decodeAudioData(await(await fetch('${prefix}/audio')).arrayBuffer());
    const buffer=ac.createBuffer(1,decoded.length+48000,24000);buffer.copyToChannel(decoded.getChannelData(0),0);
    const source=ac.createBufferSource();source.buffer=buffer;const dest=ac.createMediaStreamDestination();source.connect(dest);
    pc=new RTCPeerConnection();for(const track of dest.stream.getTracks())pc.addTrack(track,dest.stream);
    pc.createDataChannel('oai-events');await pc.setLocalDescription(await pc.createOffer());
    const response=await post('offer',pc.localDescription.sdp);if(!response.ok)throw Error('signal');
    await pc.setRemoteDescription({type:'answer',sdp:(await response.json()).sdp});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('connect')),20000);
      const check=()=>{if(pc.connectionState==='connected'){clearTimeout(timer);resolve();}
        else if(pc.connectionState==='failed'){clearTimeout(timer);reject(Error('connect'));}};
      pc.onconnectionstatechange=check;check();});
    await new Promise(resolve=>{source.onended=resolve;source.start();});await post('ended');
    const deadline=Date.now()+25000;let ready=false;
    while(Date.now()<deadline){ready=(await(await fetch('${prefix}/status')).json()).ready;if(ready)break;await new Promise(r=>setTimeout(r,200));}
    await post(ready?'done':'failed');
  }catch{await post('failed');}finally{if(pc)pc.close();if(ac)await ac.close();}})();</script>`;
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (signal.aborted) { res.writeHead(410).end(); return; }
      if (req.method === 'GET' && req.url === prefix + '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
      if (req.method === 'GET' && req.url === prefix + '/audio') { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
      if (req.method === 'GET' && req.url === prefix + '/status') { res.end(JSON.stringify({ ready: ready() })); return; }
      if (req.method !== 'POST' || !req.url?.startsWith(prefix + '/')) { res.writeHead(404).end(); return; }
      let body = ''; for await (const part of req) { body += part; if (body.length > 100000) throw Error('body_limit'); }
      if (req.url === prefix + '/offer') {
        await rpc.request('thread/realtime/start', { threadId, version: 'v3', outputModality: 'audio',
          prompt: 'You are a native Codex voice input terminal. Transcribe all spoken requests accurately and acknowledge only Received. Do not execute, delegate, or call tools. A separate desktop task executes the transcribed request.',
          transport: { type: 'webrtc', sdp: body } }, 30000);
        const deadline = Date.now() + 30000;
        while (!sdp && Date.now() < deadline && !signal.aborted) await delay(100);
        if (!sdp) throw Error('native_voice_unavailable'); res.end(JSON.stringify({ sdp })); return;
      }
      if (req.url === prefix + '/ended') endedAt = Date.now();
      else if (req.url === prefix + '/done') { if (!ready()) throw Error('incomplete_transcript'); finish(); }
      else if (req.url === prefix + '/failed') finish(Error('native_voice_incomplete'));
      else { res.writeHead(404).end(); return; }
      res.end('{}');
    } catch { res.writeHead(502).end('{}'); finish(Error('native_voice_failed')); }
  });
  let media: MediaHandle | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await rpc.initialize(); signal.throwIfAborted();
    const instructions = 'Native audio transcription only. Do not use tools, read files, change files, execute commands or delegate. Acknowledge only Received.';
    const started = await rpc.request('thread/start', { ephemeral: true, cwd: resolve('.private/codex-validation'), sandbox: 'read-only',
      approvalPolicy: 'never', baseInstructions: instructions, developerInstructions: instructions });
    threadId = started.thread.id;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('media_listener_failed');
    media = await mediaHost.openWebRtc(`http://127.0.0.1:${address.port}${prefix}/`, profile);
    timeout = setTimeout(() => finish(Error('native_voice_timeout')), 110000);
    await finished; signal.throwIfAborted();
    if (!ready()) throw Error('incomplete_transcript');
    const text = utterances.join('\n').trim(); if (!text || text.length > 12000) throw Error('invalid_transcript');
    return text;
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort);
    if (threadId) { try { await rpc.request('thread/realtime/stop', { threadId }, 5000); } catch {} }
    rpc.close(); server.closeAllConnections(); server.close(); await media?.stop();
  }
}
