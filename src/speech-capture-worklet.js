// A same-origin AudioWorklet keeps microphone processing off the UI thread.
// Integrating samples over each output interval preserves time at any input
// sample rate and averages adjacent samples when downsampling.
class SpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.weight = 0;
    this.sum = 0;
    this.buffer = new Int16Array(2400);
    this.length = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.stopped = true;
        if (this.weight > 0) this.write(this.sum / this.weight);
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  write(value) {
    const sample = Math.max(-1, Math.min(1, value));
    this.buffer[this.length++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
    if (this.length === this.buffer.length) this.flush();
  }
  flush() {
    if (!this.length) return;
    const pcm = this.buffer.slice(0, this.length).buffer;
    this.length = 0;
    this.port.postMessage({ type: 'pcm', pcm }, [pcm]);
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      sample /= channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const weight = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * weight;
        this.weight += weight;
        remaining -= weight;
        if (this.weight >= this.ratio - 1e-8) {
          this.write(this.sum / this.weight);
          this.sum = 0;
          this.weight = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ovd-speech-capture', SpeechCaptureProcessor);
