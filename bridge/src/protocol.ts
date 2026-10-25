import { createHmac, timingSafeEqual } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const RATE = 16000;
export const MAX_AUDIO_BYTES = RATE * 2 * 30;
export const MAX_FRAME_BYTES = 1292;
export const MAX_TEXT_BYTES = 6144;
export function authProof(secret: string, challenge: string): string {
  return createHmac('sha256', secret).update(challenge).digest('hex');
}
export function verifyProof(secret: string, challenge: string, proof: unknown): boolean {
  return typeof proof === 'string' && /^[a-f0-9]{64}$/.test(proof) &&
    timingSafeEqual(Buffer.from(authProof(secret, challenge), 'hex'), Buffer.from(proof, 'hex'));
}
export class AudioInput {
  readonly id: number;
  readonly sessionId: string;
  private sequence = 0;
  private size = 0;
  private frames: Buffer[] = [];
  constructor(id: number, sessionId: string) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff) throw Error('invalid_input');
    this.id = id; this.sessionId = sessionId;
  }
  append(frame: Buffer) {
    if (frame.length < 14 || frame.length > MAX_FRAME_BYTES || frame.length % 2 ||
        frame.toString('ascii', 0, 4) !== 'MTA1' || frame.readUInt32LE(4) !== this.id ||
        frame.readUInt32LE(8) !== this.sequence) throw Error('invalid_audio_frame');
    if (this.size + frame.length - 12 > MAX_AUDIO_BYTES) throw Error('audio_limit');
    this.sequence++; this.size += frame.length - 12; this.frames.push(Buffer.from(frame.subarray(12)));
  }
  finish(frames: unknown): Buffer {
    if (frames !== this.sequence || this.size < RATE / 5) throw Error('incomplete_audio');
    return Buffer.concat(this.frames, this.size);
  }
}
export function truncateUtf8(text: string, maxBytes = MAX_TEXT_BYTES): string {
  let result = '', size = 0;
  for (const char of text) { const n = Buffer.byteLength(char); if (size + n > maxBytes) break; result += char; size += n; }
  return result;
}
export function pcm16kToWav24k(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_AUDIO_BYTES) throw Error('invalid_pcm');
  const samples = Math.floor(pcm.length / 2 * 1.5);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const x = i / 1.5, a = Math.floor(x), b = Math.min(a + 1, pcm.length / 2 - 1);
    wav.writeInt16LE(Math.round(pcm.readInt16LE(a * 2) * (1 - (x - a)) + pcm.readInt16LE(b * 2) * (x - a)), 44 + i * 2);
  }
  return wav;
}
