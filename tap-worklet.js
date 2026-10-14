// Taps the mic stream and ships raw samples to the main thread in 2048-frame chunks,
// stamped with the context frame of the first sample (the device's own sample clock).
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.SIZE = 2048;
    this.buf = null;
    this.n = 0;
    this.ch = 0;
    this.start = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    const ch = inp && inp.length ? inp.length : this.ch || 1;
    if (!this.buf || this.ch !== ch) {
      this.ch = ch;
      this.buf = Array.from({ length: ch }, () => new Float32Array(this.SIZE));
      this.n = 0;
    }
    if (this.n === 0) this.start = currentFrame;
    for (let c = 0; c < ch; c++) {
      if (inp && inp[c]) this.buf[c].set(inp[c], this.n);
    }
    this.n += 128;
    if (this.n >= this.SIZE) {
      this.port.postMessage({ frame: this.start, ch, data: this.buf }, this.buf.map((b) => b.buffer));
      this.buf = null;
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('tap', Tap);
