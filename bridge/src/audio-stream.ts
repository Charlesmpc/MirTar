import { MAX_AUDIO_BYTES, RATE } from './protocol.ts';

// Laptop-side backlog, not badge RAM. Startup can briefly trail live capture.
export const MAX_PENDING_AUDIO_BYTES = RATE * 2 * 30;
export class PcmStream implements AsyncIterable<Buffer> {
  private chunks: Buffer[] = [];
  private queued = 0;
  private total = 0;
  private ended = false;
  private failure?: Error;
  private wake?: () => void;
  get totalBytes() { return this.total; }
  get pendingBytes() { return this.queued; }
  append(pcm: Buffer) {
    if (this.failure) throw this.failure;
    if (this.ended) throw Error('audio_closed');
    if (!pcm.length || pcm.length % 2) throw Error('invalid_pcm');
    if (this.total + pcm.length > MAX_AUDIO_BYTES) throw Error('audio_limit');
    if (this.queued + pcm.length > MAX_PENDING_AUDIO_BYTES) throw Error('audio_backpressure');
    this.total += pcm.length; this.queued += pcm.length; this.chunks.push(Buffer.from(pcm)); this.wake?.();
  }
  end() { this.ended = true; this.wake?.(); }
  abort(error = Error('input_cancelled')) {
    this.failure = error; this.chunks = []; this.queued = 0; this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.failure) throw this.failure;
      const chunk = this.chunks.shift();
      if (chunk) { this.queued -= chunk.length; yield chunk; continue; }
      if (this.ended) return;
      await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
    }
  }
}
