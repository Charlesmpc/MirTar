// Fixed 30-second ring in the laptop media engine. Never overwrite unread audio.
class PcmSource extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(sampleRate * 30);
    this.read = 0; this.write = 0; this.size = 0; this.consumed = 0;
    this.started = false; this.ended = false; this.failed = false; this.drained = false; this.tail = 0;
    this.port.onmessage = ({ data }) => {
      if (data.end) { this.ended = true; return; }
      const pcm = new DataView(data);
      if (pcm.byteLength % 2 || this.ended || this.failed || this.size + pcm.byteLength / 2 > this.ring.length) {
        this.failed = true; this.port.postMessage({ error: true }); return;
      }
      for (let n = 0; n < pcm.byteLength; n += 2) {
        this.ring[this.write] = pcm.getInt16(n, true) / 32768;
        this.write = (this.write + 1) % this.ring.length; this.size++;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0]; output.fill(0);
    if (this.failed || this.drained) return true;
    if (!this.started && (this.size >= sampleRate * 0.15 || this.ended)) this.started = true;
    if (!this.started) return true;
    for (let i = 0; i < output.length; i++) {
      if (this.size) {
        output[i] = this.ring[this.read]; this.read = (this.read + 1) % this.ring.length;
        this.size--; this.consumed++;
      } else if (this.ended && ++this.tail >= sampleRate * 2) {
        this.drained = true; this.port.postMessage({ drained: true, samples: this.consumed }); break;
      }
    }
    return true;
  }
}
registerProcessor('mirtar-pcm', PcmSource);
