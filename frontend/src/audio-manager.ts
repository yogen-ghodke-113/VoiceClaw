/**
 * AudioManager — Mic capture (16kHz PCM) and speaker playback (24kHz PCM).
 *
 * Capture: AudioContext at 16kHz + AudioWorklet → Int16 PCM → base64
 * Playback: base64 → Int16 → Float32 → AudioBuffer at 24kHz → speakers
 */

import { log } from "./debug-log";

export type AudioChunkCallback = (base64Pcm: string) => void;
let chunksSent = 0;
let chunksPlayed = 0;


export class AudioManager {
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private onChunk: AudioChunkCallback | null = null;
  private captureStartListeners: (() => void)[] = [];
  private captureEndListeners: (() => void)[] = [];

  // Analysers for UI visualization
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  // Accumulated chunks for STT transcription
  private sttChunks: string[] = [];
  private isCapturing = false;
  private mode: "push-to-talk" | "toggle" | "always-on" = "always-on";

  // Playback scheduling — gapless audio
  private nextStartTime = 0;
  private playbackQueueProcessing = false;
  private playbackQueue: Float32Array[] = [];
  private activePlaybackSources: AudioBufferSourceNode[] = [];

  // Wake word
  private wakeWordRecognizer: any = null;
  private isWakeWordListening = false;

  async init(): Promise<void> {
    // DO NOT create AudioContext here. Wait for user gesture in startCapture/toggleCapture.
    log("AUDIO", "AudioManager listeners initialized. Waiting for user gesture to create AudioContext.");
    
    // Spacebar handling — push-to-talk or toggle depending on mode
    // NOTE: setupWakeWord() NOT called here — SpeechRecognition competes for mic device.
    // Wake word is activated after first successful mic capture instead.

    // Spacebar handling — push-to-talk or toggle depending on mode
    document.addEventListener("keydown", (e) => {
      if (
        e.code === "Space" &&
        !e.repeat &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        if (this.mode === "push-to-talk") {
          this.startCapture();
        } else if (this.mode === "toggle") {
          this.toggleCapture();
        }
      }
    });

    document.addEventListener("keyup", (e) => {
      if (
        e.code === "Space" &&
        this.mode === "push-to-talk" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        this.stopCapture();
      }
    });
  }

  private setupWakeWord(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      log("AUDIO", "SpeechRecognition API not supported, wake word disabled.");
      return;
    }

    this.wakeWordRecognizer = new SpeechRecognition();
    this.wakeWordRecognizer.continuous = true;
    this.wakeWordRecognizer.interimResults = true;
    this.wakeWordRecognizer.lang = 'pt-BR';

    this.wakeWordRecognizer.onresult = (event: any) => {
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.toLowerCase();
      
      if (transcript.includes('jarvis') || transcript.includes('j.a.r.v.i.s')) {
        log("AUDIO", "Wake word 'Jarvis' detected!");
        if (!this.isCapturing) {
          this.startCapture();
        }
      }
    };

    this.wakeWordRecognizer.onend = () => {
      if (this.isWakeWordListening) {
        try {
          this.wakeWordRecognizer.start();
        } catch (e) {}
      }
    };
  }

  startWakeWord(): void {
    if (this.wakeWordRecognizer && !this.isWakeWordListening) {
      this.isWakeWordListening = true;
      try {
        this.wakeWordRecognizer.start();
        log("AUDIO", "Wake word listener started.");
      } catch (e) {
        log("AUDIO", "Error starting wake word listener: " + e);
      }
    }
  }

  stopWakeWord(): void {
    if (this.wakeWordRecognizer && this.isWakeWordListening) {
      this.isWakeWordListening = false;
      try {
        this.wakeWordRecognizer.stop();
        log("AUDIO", "Wake word listener stopped.");
      } catch (e) {}
    }
  }

  setMode(mode: "push-to-talk" | "toggle" | "always-on"): void {
    this.mode = mode;
    if (mode === "always-on") {
      this.startCapture();
    } else if (mode === "push-to-talk" || mode === "toggle") {
      this.stopCapture();
    }
  }

  isActive(): boolean {
    return this.isCapturing;
  }

  getMode(): string {
    return this.mode;
  }

  /** Get accumulated audio chunks for STT and clear the buffer. */
  flushSttChunks(): string[] {
    const chunks = this.sttChunks;
    this.sttChunks = [];
    return chunks;
  }

  private isToggling = false;
  async toggleCapture(): Promise<void> {
    if (this.isToggling) return;
    this.isToggling = true;
    
    try {
      if (this.isCapturing) {
        this.stopCapture();
      } else {
        await this.startCapture();
      }
    } finally {
      // Debounce toggle to prevent rapid clicks from breaking device state
      setTimeout(() => { this.isToggling = false; }, 300);
    }
  }

  setOnChunk(callback: AudioChunkCallback): void {
    this.onChunk = callback;
  }

  setOnCaptureStart(callback: () => void): void {
    if (!this.captureStartListeners.includes(callback)) {
      this.captureStartListeners.push(callback);
    }
  }

  setOnCaptureEnd(callback: () => void): void {
    if (!this.captureEndListeners.includes(callback)) {
      this.captureEndListeners.push(callback);
    }
  }

  clearListeners(): void {
    this.captureStartListeners = [];
    this.captureEndListeners = [];
  }

  async startCapture(): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;

    // Immediate visual feedback
    document.getElementById("mic-btn")?.classList.add("active");
    document.getElementById("mic-hint")!.textContent = "Listening...";

    try {
      // 1. Stop wake word to free up device if necessary
      this.stopWakeWord();

      // 2. Get mic FIRST — before creating AudioContext.
      // This ensures hardware permission is granted before we try to use the audio system.
      // Pattern inspired by jarvis-tutorial: secure hardware access before processing.
      if (!this.micStream || !this.micStream.active) {
        log("AUDIO", "Requesting microphone access...");
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            // Prefer 16kHz to minimize resampling, but accept any rate
            sampleRate: { ideal: 16000 },
          },
        });
        const micTrack = this.micStream.getAudioTracks()[0];
        const settings = micTrack.getSettings();
        log("AUDIO", `Mic acquired: ${micTrack.label}, rate=${settings.sampleRate || 'default'}, channels=${settings.channelCount || 1}`);
      }

      // 3. Create or recover AudioContext
      if (!this.ctx || this.ctx.state === "closed") {
        await this.createAudioContext();
      }

      // 4. If context is suspended (autoplay policy or error recovery), resume it
      if (this.ctx!.state === "suspended") {
        await this.ctx!.resume();
        log("AUDIO", "Context resumed from suspended state");
      }

      // 5. If context went to error state, recreate
      if (this.ctx!.state !== "running") {
        log("AUDIO", `Context in unexpected state '${this.ctx!.state}', recreating...`);
        try { this.ctx!.close(); } catch {}
        this.ctx = null;
        await this.createAudioContext();
        await this.ctx!.resume();
      }

      this.sourceNode = this.ctx!.createMediaStreamSource(this.micStream!);

      // Add gain to boost signal for better VAD detection
      const gainNode = this.ctx!.createGain();
      gainNode.gain.value = 1.5; // 1.5x boost (lowered from 2.0 to help VAD)
      this.sourceNode.connect(gainNode);

      // Input analyser for UI visualization
      this.inputAnalyser = this.ctx!.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      gainNode.connect(this.inputAnalyser);

      // Create AudioWorklet node
      this.workletNode = new AudioWorkletNode(this.ctx!, "pcm-worklet-processor");

      // Receive PCM chunks from worklet thread
      this.workletNode.port.onmessage = (event) => {
        if (!this.isCapturing || !this.onChunk) return;

        const pcm16Buffer: ArrayBuffer = event.data.pcm16;
        const base64 = arrayBufferToBase64(pcm16Buffer);

        chunksSent++;
        this.sttChunks.push(base64);
        if (chunksSent % 50 === 1) {
          log("AUDIO_IN", `Sending chunk #${chunksSent}, ${base64.length} chars, sampleRate=${this.ctx?.sampleRate}`);
        }
        this.onChunk(base64);
      };

      // Connect boosted signal → worklet for processing
      gainNode.connect(this.workletNode);
      // NOTE: Do NOT connect worklet to ctx.destination — this prevents audio
      // feedback loops that can crash Windows WASAPI drivers. The worklet only
      // needs to receive data, not output it. Playback uses separate BufferSources.

      log("AUDIO_IN", `Capture started (AudioWorklet), sampleRate=${this.ctx!.sampleRate}, mode=${this.mode}`);

      // Notify listeners — só em modos manuais (PTT/Toggle)
      // Em always-on, o Gemini gerencia VAD automaticamente via automaticActivityDetection
      if (this.mode !== "always-on") {
        this.captureStartListeners.forEach((cb) => cb());
      }
    } catch (err) {
      log("AUDIO_IN", `Capture failed: ${err}`);
      this.isCapturing = false;
      document.getElementById("mic-btn")?.classList.remove("active");
      document.getElementById("mic-hint")!.textContent = "Mic Error — try again";
    }
  }

  /** Create a Windows-compatible AudioContext with explicit 48kHz sample rate. */
  private async createAudioContext(): Promise<void> {
    log("AUDIO", "Creating AudioContext (48kHz WASAPI-compatible)...");

    // Use 48kHz explicitly — this is the standard Windows WASAPI shared-mode rate.
    // Letting Chrome auto-detect can cause driver conflicts on some hardware.
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: "interactive",
    });

    log("AUDIO", `AudioContext created: sampleRate=${this.ctx.sampleRate}Hz, state=${this.ctx.state}`);

    this.ctx.onstatechange = () => {
      log("AUDIO", `Context state → ${this.ctx?.state}`);
      // Auto-recovery: if context gets suspended unexpectedly during capture, try to resume
      if (this.ctx?.state === "suspended" && this.isCapturing) {
        log("AUDIO", "Context suspended during capture, attempting auto-resume...");
        this.ctx.resume().catch((e) => log("AUDIO", `Auto-resume failed: ${e}`));
      }
    };

    (this.ctx as any).onerror = (event: any) => {
      log("AUDIO", `⚠️ AudioContext hardware error: ${event?.message || event}`);
    };

    this.outputAnalyser = this.ctx.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.connect(this.ctx.destination);

    // Load worklet
    await this.ctx.audioWorklet.addModule("/pcm-worklet-processor.js");
    log("AUDIO", "Worklet module loaded successfully");
  }

  stopCapture(): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.workletNode = null;
    this.sourceNode = null;

    // Release mic so browser stops showing recording indicator
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    // Restart wake word after capture if it was enabled
    this.startWakeWord();

    // Update UI
    document.getElementById("mic-btn")?.classList.remove("active");
    const hint = this.mode === "always-on" ? "Always-On Active" : (this.mode === "toggle" ? "Tap Space to Talk" : "Hold Space to Talk");
    document.getElementById("mic-hint")!.textContent = hint;
    log("AUDIO_IN", `Capture stopped, ${chunksSent} chunks sent total`);

    // Notify listeners — só em modos manuais (PTT/Toggle)
    // Em always-on, o Gemini fecha o turno automaticamente via automaticActivityDetection
    if (this.mode !== "always-on") {
      this.captureEndListeners.forEach((cb) => cb());
    }
  }

  /**
   * Queue Gemini's audio response for playback.
   * Expects base64-encoded 24kHz 16-bit PCM.
   */
  queuePlayback(pcm24kBase64: string): void {
    // Lazy-create AudioContext for playback if it doesn't exist yet
    if (!this.ctx || this.ctx.state === "closed") {
      log("AUDIO_OUT", "Creating AudioContext on demand for playback...");
      // Use the same centralized method, but it's async so we create synchronously here
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      log("AUDIO_OUT", `Playback context created: sampleRate=${this.ctx.sampleRate}Hz`);
      
      this.ctx.onstatechange = () => {
        log("AUDIO", `Context state → ${this.ctx?.state}`);
      };
      (this.ctx as any).onerror = (event: any) => {
        log("AUDIO", `⚠️ AudioContext hardware error: ${event?.message || event}`);
      };

      this.outputAnalyser = this.ctx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.connect(this.ctx.destination);
    }

    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const float32 = base64ToFloat32Audio(pcm24kBase64);
    chunksPlayed++;
    if (chunksPlayed === 1) {
      log("AUDIO_OUT", `Playback started, ctx.state=${this.ctx?.state}`);
    }
    this.playbackQueue.push(float32);

    if (!this.playbackQueueProcessing) {
      this.processPlaybackQueue();
    }
  }

  private processPlaybackQueue(): void {
    if (!this.ctx || this.playbackQueue.length === 0) {
      if (chunksPlayed > 0) {
        log("AUDIO_OUT", `Playback queued ${chunksPlayed} chunks`);
        chunksPlayed = 0;
      }
      this.playbackQueueProcessing = false;
      return;
    }

    this.playbackQueueProcessing = true;

    // Resume if suspended
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    while (this.playbackQueue.length > 0) {
      const samples = this.playbackQueue.shift()!;

      const buffer = this.ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      // Connect to output analyser before destination
      if (this.outputAnalyser) {
        source.connect(this.outputAnalyser);
      } else {
        source.connect(this.ctx.destination);
      }

      // Schedule gapless playback
      if (this.nextStartTime < this.ctx.currentTime) {
        this.nextStartTime = this.ctx.currentTime;
      }
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;

      // Track active sources for interruption
      this.activePlaybackSources.push(source);
      source.onended = () => {
        const idx = this.activePlaybackSources.indexOf(source);
        if (idx !== -1) this.activePlaybackSources.splice(idx, 1);
      };
    }

    this.playbackQueueProcessing = false;
  }

  /** Stop all queued and playing audio immediately (for interruption). */
  clearPlayback(): void {
    // Clear pending queue
    this.playbackQueue = [];
    this.playbackQueueProcessing = false;

    // Stop all currently playing sources
    for (const source of this.activePlaybackSources) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    this.activePlaybackSources = [];

    // Reset scheduling
    this.nextStartTime = 0;
    chunksPlayed = 0;

    log("AUDIO_OUT", "Playback cleared (interrupted)");
  }

  getInputAnalyser(): AnalyserNode | null {
    return this.inputAnalyser;
  }

  getOutputAnalyser(): AnalyserNode | null {
    return this.outputAnalyser;
  }

  destroy(): void {
    this.stopCapture();
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.clearPlayback();
    this.ctx?.close();
    this.ctx = null;
  }
}

// ── Audio utility functions ──────────────────────────────────

/** Decode base64 PCM 16-bit to Float32Array for Web Audio playback. */
function base64ToFloat32Audio(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // 16-bit PCM little-endian → Float32
  const length = bytes.length / 2;
  const float32 = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sample = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    if (sample >= 32768) sample -= 65536;
    float32[i] = sample / 32768;
  }
  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
