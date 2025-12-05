class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4800; // ~200 ms @ 24 kHz
    this.buffer = new Float32Array(0);
    // Silence-Filter DEAKTIVIERT für Debugging
    // this.silenceThreshold = 0.01;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;

    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.subarray(0, this.chunkSize);
      this.buffer = this.buffer.subarray(this.chunkSize);
      // Immer senden (Silence-Filter aus für Debug)
      const copy = new Float32Array(chunk);
      this.port.postMessage(copy);
    }
    return true;
  }
}

registerProcessor("pcm16-processor", PCM16Processor);
