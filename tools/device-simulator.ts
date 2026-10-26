// Sends an explicitly supplied test WAV through the same device protocol.
// This is a desktop integration test, not evidence of card hardware operation.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { authProof, MAX_RECORDING_SECONDS } from '../bridge/src/protocol.ts';
import type { BridgeConfig } from '../bridge/src/contracts.ts';
import { setTimeout as delay } from 'node:timers/promises';

const [configPath, audioPath, confirmation] = process.argv.slice(2);
if (!configPath || !audioPath || confirmation !== '--confirm-native-test') throw Error('Usage: npm run device -- PRIVATE_BRIDGE_CONFIG WAV --confirm-native-test');
const config = JSON.parse(await readFile(configPath, 'utf8')) as BridgeConfig;
const wav = await readFile(audioPath);
let rate = 0, pcm: Buffer | undefined;
if (wav.toString('ascii', 0, 4) !== 'RIFF') throw Error('WAV required');
for (let pos = 12; pos + 8 <= wav.length;) {
  const size = wav.readUInt32LE(pos + 4), start = pos + 8;
  if (start + size > wav.length) throw Error('Truncated WAV');
  const type = wav.toString('ascii', pos, pos + 4);
  if (type === 'fmt ') {
    if (size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16) throw Error('Mono PCM16 required');
    rate = wav.readUInt32LE(start + 4);
  }
  if (type === 'data') pcm = wav.subarray(start, start + size);
  pos = start + size + size % 2;
}
if (!pcm || ![16000, 24000].includes(rate) || pcm.length > rate * 2 * MAX_RECORDING_SECONDS) throw Error('Expected 16k/24k mono WAV, at most 600 seconds');
const samples = Math.floor(pcm.length / 2 * 16000 / rate), input = Buffer.alloc(samples * 2);
for (let i = 0; i < samples; i++) {
  const x = i * rate / 16000, a = Math.floor(x), b = Math.min(a + 1, pcm.length / 2 - 1);
  input.writeInt16LE(Math.round(pcm.readInt16LE(a*2)*(1-x+a) + pcm.readInt16LE(b*2)*(x-a)), i*2);
}
const device = config.devices[0], sessionId = config.codex.sessions[0].id;
const ws = new WebSocket(`ws://${config.listen.host}:${config.listen.port}/device`);
let committed = false, accepted = false;
let replyReceived = false;
const timeout = setTimeout(() => { console.error('Integration timeout'); ws.terminate(); process.exitCode = 1; }, (MAX_RECORDING_SECONDS + 180) * 1000);
const send = (msg: unknown) => ws.send(JSON.stringify(msg));
ws.on('open', () => send({ type: 'hello', version: 1, deviceId: device.id, bootId: randomBytes(16).toString('hex') }));
ws.on('error', () => { console.error('Connection failed'); process.exitCode = 1; clearTimeout(timeout); });
ws.on('message', async raw => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'challenge') send({ type: 'auth', proof: authProof(device.secret, msg.challenge) });
  else if (msg.type === 'bound') {
    console.log('BOUND', { sessions: msg.sessions.length }); send({ type: 'select', sessionId });
  } else if (msg.type === 'selected') {
    send({ type: 'begin', id: 1 }); let frames = 0;
    for (let offset = 0; offset < input.length; offset += 640) {
      const chunk = input.subarray(offset, offset + 640), frame = Buffer.alloc(12 + chunk.length);
      frame.write('MTA1'); frame.writeUInt32LE(1, 4); frame.writeUInt32LE(frames++, 8); chunk.copy(frame, 12); ws.send(frame);
      await delay(20);
    }
    send({ type: 'commit', id: 1, frames }); committed = true;
    console.log('COMMITTED', { frames, audioSeconds: input.length / 32000 });
  } else if (msg.type === 'state') {
    console.log('STATE', msg.state); if (msg.state === 'accepted') accepted = true;
    if (msg.state === 'completed' && msg.id === 1 && replyReceived) {
      console.log('INPUT_CORRELATION_PASS'); clearTimeout(timeout); ws.close();
    }
  } else if (msg.type === 'reply' && committed && accepted) {
    console.log('FORMAL_REPLY', JSON.stringify({ text: msg.text, completed: msg.completed, turnId: msg.turnId }));
    replyReceived = true;
    if (!msg.completed) process.exitCode = 1;
  } else if (msg.type === 'error') { console.error('DEVICE_ERROR', msg.code); process.exitCode = 1; clearTimeout(timeout); ws.close(); }
});
ws.on('close', () => clearTimeout(timeout));
