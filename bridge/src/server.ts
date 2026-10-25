import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isIPv4 } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentAdapter, BridgeConfig } from './contracts.ts';
import { AudioInput, truncateUtf8, verifyProof } from './protocol.ts';
import type { DevicePeer } from './transport/peer.ts';

type Receipt = { status: string; clientId: string; submissionId?: string };
export async function startBridge(config: BridgeConfig, adapter: AgentAdapter, receiptRoot = '.private/receipts') {
  if (config.version !== 1 || config.listen.allowLanPlaintext !== true) throw Error('LAN plaintext must be explicitly enabled for this development build');
  const host = config.listen.host, octets = host.split('.').map(Number);
  if (!isIPv4(host) || !(octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
      octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)) throw Error('Bind a specific private LAN or loopback IPv4 address');
  if (!config.devices.length || config.devices.some(d => !/^[a-zA-Z0-9_-]{1,40}$/.test(d.id) || d.secret.length < 32)) throw Error('invalid_device_configuration');
  await mkdir(receiptRoot, { recursive: true });
  const activeDevices = new Set<string>();
  const peers = new Set<DevicePeer>();
  const runningJobs = new Set<Promise<void>>();
  const server = createServer((_req, res) => { res.writeHead(404).end(); });
  const wss = new WebSocketServer({ server, path: '/device', maxPayload: 8192, perMessageDeflate: false });
  wss.on('connection', (ws, request) => {
    if (request.headers.origin) { ws.close(1008, 'native device only'); return; }
    acceptPeer(ws);
  });
  function acceptPeer(ws: DevicePeer) {
    peers.add(ws);
    let deviceId = '', bootId = '', secret = '', authenticated = false, selected = '', lastReply = '', polling = false;
    let recording: AudioInput | undefined, audioTimer: NodeJS.Timeout | undefined;
    let operation: AbortController | undefined, alive = true;
    let awaitingReply: { sessionId: string; baseline: string; accepted: boolean; clientId: string; id: number } | undefined;
    const challenge = randomBytes(32).toString('hex');
    const send = (message: any) => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= 32768) return;
      let encoded = JSON.stringify(message);
      if (Buffer.byteLength(encoded) > 8000 && message.type === 'reply') {
        message = { ...message, truncated: true };
        while (Buffer.byteLength(encoded) > 8000 && message.text.length) {
          message.text = truncateUtf8(message.text, Math.max(0, Buffer.byteLength(message.text) - 512));
          encoded = JSON.stringify(message);
        }
      }
      if (Buffer.byteLength(encoded) <= 8000) ws.send(encoded);
    };
    const error = (code: string) => send({ type: 'error', code, sessionId: selected });
    const discard = () => { recording = undefined; clearTimeout(audioTimer); };
    const authTimeout = setTimeout(() => ws.close(1008, 'authentication timeout'), 5000);
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 15000);
    ws.on('pong', () => { alive = true; });
    const poll = setInterval(async () => {
      if (!authenticated || !selected || polling) return;
      polling = true; const sessionId = selected;
      try {
        const replies = await adapter.history(sessionId), latest = replies.at(-1);
        if (selected === sessionId && latest && latest.turnId !== lastReply) {
          lastReply = latest.turnId; const text = truncateUtf8(latest.text);
          send({ type: 'reply', sessionId, turnId: latest.turnId, text, truncated: text !== latest.text, completed: latest.completed });
        }
        const awaiting = awaitingReply;
        if (awaiting?.accepted && awaiting.sessionId !== sessionId) {
          const result = (await adapter.history(awaiting.sessionId)).at(-1);
          if (result && result.turnId !== awaiting.baseline && result.inputId === awaiting.clientId) {
            send({ type: 'reply', sessionId: awaiting.sessionId, turnId: result.turnId, text: truncateUtf8(result.text),
              truncated: Buffer.byteLength(result.text) > 6144, completed: result.completed });
            send({ type: 'state', state: 'completed', sessionId: awaiting.sessionId, id: awaiting.id });
            if (awaitingReply === awaiting) awaitingReply = undefined;
          }
        } else if (awaiting?.accepted && latest && latest.turnId !== awaiting.baseline && latest.inputId === awaiting.clientId) {
          send({ type: 'state', state: 'completed', sessionId: awaiting.sessionId, id: awaiting.id }); awaitingReply = undefined;
        }
      } catch { if (selected === sessionId) error('agent_unavailable'); }
      finally { polling = false; }
    }, 1500);
    async function handle(data: Buffer, binary: boolean) {
      if (binary) { if (!authenticated || !recording) throw Error('unexpected_audio'); recording.append(data); return; }
      if (data.length > 2048) throw Error('control_limit');
      const msg = JSON.parse(data.toString('utf8'));
      if (!msg || typeof msg !== 'object') throw Error('invalid_message');
      if (!authenticated) {
        if (msg.type === 'hello' && !deviceId && msg.version === 1 && /^[a-f0-9]{32}$/.test(msg.bootId)) {
          const device = config.devices.find(d => d.id === msg.deviceId);
          if (!device || activeDevices.has(device.id)) throw Error('authentication_failed');
          deviceId = device.id; secret = device.secret; bootId = msg.bootId;
          send({ type: 'challenge', challenge }); return;
        }
        if (msg.type !== 'auth' || !deviceId || !verifyProof(secret, challenge, msg.proof)) throw Error('authentication_failed');
        if (activeDevices.has(deviceId)) throw Error('device_already_connected');
        authenticated = true; activeDevices.add(deviceId); clearTimeout(authTimeout);
        send({ type: 'bound', version: 1, adapterId: adapter.id, sessions: await adapter.sessions(),
          audio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1, maxSeconds: 30 },
          capabilities: { textReply: true, liveRuntimeState: false, approvals: false, tts: false } }); return;
      }
      if (msg.type === 'select') {
        if (recording) throw Error('recording_locked');
        if (!(await adapter.sessions()).some(s => s.id === msg.sessionId)) throw Error('session_unavailable');
        selected = msg.sessionId; lastReply = ''; send({ type: 'selected', sessionId: selected }); return;
      }
      if (msg.type === 'cancel') { discard(); operation?.abort(); send({ type: 'state', state: 'cancelled', sessionId: selected }); return; }
      if (msg.type === 'begin') {
        if (!selected || recording || operation || awaitingReply) throw Error('busy');
        recording = new AudioInput(msg.id, selected);
        audioTimer = setTimeout(() => { discard(); error('audio_timeout'); }, 35000);
        send({ type: 'state', state: 'recording', id: msg.id, sessionId: selected }); return;
      }
      if (msg.type === 'commit') {
        const input = recording; if (!input || input.id !== msg.id) throw Error('no_recording');
        const pcm = input.finish(msg.frames); discard();
        const baseline = (await adapter.history(input.sessionId)).at(-1)?.turnId || '';
        const key = createHash('sha256').update(`${deviceId}:${bootId}:${input.id}`).digest('hex');
        const receiptPath = resolve(receiptRoot, key + '.json');
        let existing: Receipt | undefined;
        try { existing = JSON.parse(await readFile(receiptPath, 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw Error('receipt_unavailable'); }
        if (existing) { send({ type: 'state', state: existing.status === 'accepted' ? 'accepted' : 'submission_unknown', sessionId: input.sessionId, id: input.id }); return; }
        const receipt: Receipt = { status: 'submission_unknown', clientId: randomUUID() };
        // Persist a conservative receipt BEFORE any native mutation. No automatic replay.
        await writeFile(receiptPath, JSON.stringify(receipt), { flag: 'wx' });
        if (ws.readyState !== WebSocket.OPEN) return;
        const controller = new AbortController(); operation = controller;
        const awaiting = { sessionId: input.sessionId, baseline, accepted: false, clientId: receipt.clientId, id: input.id }; awaitingReply = awaiting;
        const progress = (state: string) => send({ type: 'state', state, sessionId: input.sessionId, id: input.id });
        const job = adapter.submitAudio(input.sessionId, pcm, receipt.clientId, controller.signal, progress).then(async result => {
          receipt.status = 'accepted'; receipt.submissionId = result.submissionId;
          awaiting.accepted = true;
          progress('accepted');
          try {
            const temp = receiptPath + '.tmp'; await writeFile(temp, JSON.stringify(receipt)); await rename(temp, receiptPath);
          } catch {
            // The native queue already acknowledged this input. Keep the earlier
            // conservative receipt rather than reporting a false submission failure.
            console.error('Receipt update unavailable; prior no-replay marker retained.');
          }
        }).catch(e => {
          if (e.message !== 'submission_unknown' && awaitingReply === awaiting) awaitingReply = undefined;
          send({ type: 'error', code: e.message === 'submission_unknown' ? 'submission_unknown' :
            controller.signal.aborted ? 'input_cancelled_or_pending' : 'input_failed', sessionId: input.sessionId, id: input.id });
        }).finally(() => { if (operation === controller) operation = undefined; runningJobs.delete(job); });
        runningJobs.add(job);
        return;
      }
      throw Error('unknown_message');
    }
    let queue = Promise.resolve(), queuedBytes = 0;
    ws.on('message', (raw: Buffer | Buffer[], binary: boolean) => {
      const data = Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]);
      queuedBytes += data.length;
      if (queuedBytes > 128 * 1024) { ws.close(1008, 'backpressure'); return; }
      queue = queue.then(() => ws.readyState === WebSocket.OPEN ? handle(data, binary) : undefined).catch(e => {
        if (!['busy', 'recording_locked', 'session_unavailable'].includes(e.message)) discard();
        error(['audio_limit', 'audio_timeout', 'busy', 'recording_locked', 'session_unavailable'].includes(e.message) ? e.message : 'protocol_error');
        if (!authenticated) ws.close(1008, 'authentication failed');
      }).finally(() => { queuedBytes -= data.length; });
    });
    ws.on('error', () => {});
    ws.on('close', () => { peers.delete(ws); discard(); operation?.abort(); clearTimeout(authTimeout); clearInterval(heartbeat); clearInterval(poll); if (authenticated) activeDevices.delete(deviceId); });
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.listen.port, config.listen.host, resolve); });
  return {
    address: server.address(),
    acceptPeer,
    async close() { for (const peer of peers) peer.terminate(); await new Promise<void>(resolve => wss.close(() => resolve()));
      await Promise.allSettled(runningJobs);
      await new Promise<void>(resolve => server.close(() => resolve())); await adapter.close(); },
  };
}
