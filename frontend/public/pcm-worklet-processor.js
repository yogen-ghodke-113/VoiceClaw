/**
 * AudioWorklet processor for PCM capture with dynamic downsampling.
 * Converts input hardware sample rate (e.g., 48kHz) to target 16kHz for Gemini.
 */

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunkSize = 2048; // Final PCM16 samples per chunk
    this._inputBuffer = [];
    this._targetSampleRate = 16000;
    this._inputSampleRate = sampleRate; // Global sampleRate provided by the context
    
    // Resampling state
    this._resampleRatio = this._inputSampleRate / this._targetSampleRate;
    this._resampleAccumulator = 0;
    
    this._outputBuffer = new Int16Array(this._chunkSize);
    this._outputIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // mono channel

    for (let i = 0; i < samples.length; i++) {
      this._resampleAccumulator += 1;

      // When we've crossed the ratio threshold, take this sample
      if (this._resampleAccumulator >= this._resampleRatio) {
        this._resampleAccumulator -= this._resampleRatio;
        
        // Convert Float32 to Int16
        const s = Math.max(-1, Math.min(1, samples[i]));
        this._outputBuffer[this._outputIndex++] = s * 0x7fff;

        if (this._outputIndex >= this._chunkSize) {
          // Send the complete chunk back to the main thread
          const pcmData = this._outputBuffer.buffer.slice(0);
          this.port.postMessage({ pcm16: pcmData }, [pcmData]);
          this._outputIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("pcm-worklet-processor", PcmWorkletProcessor);
