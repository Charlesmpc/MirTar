import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexRpc } from './rpc.ts';
import { MAX_RECORDING_SECONDS } from '../protocol.ts';
import type { PcmStream } from '../audio-stream.ts';
import type { MediaHost, MediaHandle } from '../host/contracts.ts';

const cleanups = new Set<Promise<void>>();
export async function drainVoiceCleanup() { await Promise.allSettled(cleanups); }

// Native Codex authentication/recognition; Edge supplies only a WebRTC track.
// The source is incremental PCM, never a complete WAV replay.
export type VoiceMilestone = 'connected' | 'first_transcript' | 'audio_drained' | 'session_closed';
type VoiceRpc = {
  initialize(): Promise<void>;
  request(method: string, params?: any, timeoutMs?: number): Promise<any>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  close(): void;
};
export async function transcribeNative(bin: string, mediaHost: MediaHost, input: PcmStream, signal: AbortSignal,
  milestone: (event: VoiceMilestone) => void = () => {}, runtime?: { rpc: VoiceRpc }): Promise<string> {
  signal.throwIfAborted();
  const rpc = runtime?.rpc ?? new CodexRpc(bin), prefix = '/' + randomUUID();
  const profile = resolve('.private/codex-validation/rtc-profile-' + randomUUID());
  let threadId = '', sdp = '', drained = false, consumed = false, ended = false, firstTranscript = false;
  let finish!: (text: string) => void, fail!: (error: Error) => void;
  const finished = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
  finished.catch(() => {});
  const abort = () => { input.abort(); fail(Error('input_cancelled')); };
  signal.addEventListener('abort', abort, { once: true });
  rpc.on('unavailable', () => fail(Error('codex_disconnected')));
  rpc.on('notification', (method: string, p: any) => {
    if (p.threadId !== threadId) return;
    if (method === 'thread/realtime/sdp') sdp = p.sdp;
    if (method === 'thread/realtime/error') fail(Error('native_voice_error'));
    if (method === 'turn/started') fail(Error('unexpected_voice_turn'));
    if (!firstTranscript && p.role === 'user' && method === 'thread/realtime/transcript/delta' && p.delta) {
      firstTranscript = true; milestone('first_transcript');
    }
  });
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (signal.aborted) { res.writeHead(410).end(); return; }
      if (req.method === 'GET' && req.url === prefix + '/') {
        res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><script src="page"></script>'); return;
      }
      if (req.method === 'GET' && [prefix + '/page', prefix + '/worklet'].includes(req.url ?? '')) {
        const file = req.url!.endsWith('/page') ? 'voice-page.js' : 'voice-worklet.js';
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(new URL(file, import.meta.url))); return;
      }
      if (req.method === 'GET' && req.url === prefix + '/stream') {
        if (consumed) { res.writeHead(409).end(); return; } consumed = true;
        clearTimeout(startupTimeout); milestone('connected');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.flushHeaders();
        for await (const pcm of input) {
          if (signal.aborted || res.destroyed) throw Error('input_cancelled');
          if (!res.write(pcm)) await once(res, 'drain', { signal });
        }
        ended = true;
        finalizationTimeout = setTimeout(() => fail(Error('native_transcript_timeout')), 125000);
        res.end(); return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith(prefix + '/')) { res.writeHead(404).end(); return; }
      let body = ''; for await (const part of req) { body += part; if (body.length > 400000) throw Error('body_limit'); }
      if (req.url === prefix + '/offer') {
        if (!threadId || sdp) throw Error('duplicate_offer');
        await rpc.request('thread/realtime/start', { threadId, version: 'v3', outputModality: 'audio',
          includeStartupContext: false,
          prompt: 'You are a native Codex voice input terminal. Transcribe all spoken requests accurately and acknowledge only Received. Do not execute, delegate, or call tools. A separate Agent session executes the transcribed request.',
          transport: { type: 'webrtc', sdp: body } }, 30000);
        const deadline = Date.now() + 30000;
        while (!sdp && Date.now() < deadline && !signal.aborted) await delay(100);
        if (!sdp) throw Error('native_voice_unavailable'); res.end(JSON.stringify({ sdp })); return;
      }
      if (req.url === prefix + '/drained') {
        const message = JSON.parse(body);
        if (!ended || message.samples !== input.totalBytes / 2) throw Error('incomplete_audio');
        drained = true; milestone('audio_drained');
      } else if (req.url === prefix + '/final') {
        const message = JSON.parse(body);
        if (!drained || message.reason !== 'client_request' || !Number.isInteger(message.segments) || message.segments < 1 ||
            typeof message.text !== 'string' || !message.text.trim() || message.text.length > 64000) throw Error('incomplete_transcript');
        milestone('session_closed'); finish(message.text.trim());
      } else if (req.url === prefix + '/failed') {
        const code = JSON.parse(body || 'null');
        const failures = ['native_transcript_timeout', 'audio_backpressure', 'incomplete_audio', 'early_close', 'stream', 'connect', 'voice_error', 'invalid_transcript'];
        fail(Error(failures.includes(code) ? code : 'native_voice_incomplete'));
      }
      else { res.writeHead(404).end(); return; }
      res.end('{}');
    } catch {
      if (!res.destroyed) { if (res.headersSent) res.destroy(); else res.writeHead(502).end('{}'); }
      fail(Error('native_voice_failed'));
    }
  });
  let media: MediaHandle | undefined;
  let finalizationTimeout: NodeJS.Timeout | undefined;
  const startupTimeout = setTimeout(() => fail(Error('native_voice_unavailable')), 60000);
  const timeout = setTimeout(() => fail(Error('native_voice_timeout')), (MAX_RECORDING_SECONDS + 150) * 1000);
  try {
    await mkdir(profile, { recursive: true });
    await rpc.initialize(); signal.throwIfAborted();
    const instructions = 'Native audio transcription only. Do not use tools, read files, change files, execute commands or delegate. Acknowledge only Received.';
    const started = await rpc.request('thread/start', { ephemeral: true, cwd: resolve('.private/codex-validation'), sandbox: 'read-only',
      approvalPolicy: 'never', baseInstructions: instructions, developerInstructions: instructions });
    threadId = started.thread.id;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    signal.throwIfAborted();
    const address = server.address(); if (!address || typeof address === 'string') throw Error('media_listener_failed');
    media = await mediaHost.openWebRtc(`http://127.0.0.1:${address.port}${prefix}/`, profile);
    return await finished;
  } finally {
    clearTimeout(timeout); clearTimeout(startupTimeout); clearTimeout(finalizationTimeout);
    signal.removeEventListener('abort', abort); input.abort();
    if (threadId) { try { await rpc.request('thread/realtime/stop', { threadId }, 5000); } catch {} }
    rpc.close(); server.closeAllConnections(); server.close();
    if (media) {
      // Native finalization is already acknowledged. Profile-scoped browser
      // cleanup must complete at shutdown, but need not delay Agent submission.
      const cleanup = media.stop().catch(() => {}); cleanups.add(cleanup);
      void cleanup.finally(() => cleanups.delete(cleanup));
    }
  }
}
