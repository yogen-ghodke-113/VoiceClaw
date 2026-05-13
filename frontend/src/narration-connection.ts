/**
 * NarrationConnection — Second Gemini Live session for narrating Claude's activity.
 *
 * Speaks real-time commentary while Claude is working, so the user isn't
 * left in silence. Coordinates with main Gemini: only plays audio when
 * main Gemini is waiting for a function response.
 */

import { GoogleGenAI, Modality } from "@google/genai";
import type { AudioManager } from "./audio-manager";
import type { ServerConfig, TokenResponse } from "./types";
import { log } from "./debug-log";

export class NarrationConnection {
  private session: any = null;
  private audioManager: AudioManager;
  private onTranscript: (text: string) => void;
  private onTurnDone: () => void;
  private muted = false;
  private connected = false;
  private disconnecting = false;
  private intentionallyClosed = false;
  private languageCode: string;

  // Batch events: collect for a short window, then send as one message
  private eventBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_DELAY_MS = 1500;

  constructor(audioManager: AudioManager, onTranscript: (text: string) => void, languageCode: string = "en-US", onTurnDone?: () => void) {
    this.audioManager = audioManager;
    this.onTranscript = onTranscript;
    this.onTurnDone = onTurnDone || (() => {});
    this.languageCode = languageCode;
  }

  async connect(): Promise<void> {
    this.disconnecting = false;
    this.intentionallyClosed = false;
    try {
      const [tokenRes, configRes] = await Promise.all([
        fetch("/api/token").then((r) => r.json()) as Promise<TokenResponse>,
        fetch("/api/narration-config").then((r) => r.json()) as Promise<ServerConfig>,
      ]);

      const ai = new GoogleGenAI({
        apiKey: tokenRes.token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      log("NARRATION", `Connecting model=${configRes.model}`);

      this.session = await ai.live.connect({
        model: configRes.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: configRes.system_prompt,
          speechConfig: {
            languageCode: this.languageCode,
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Algenib" },
            },
          },
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
          thinkingConfig: {
            thinkingLevel: "high" as any,
          },
          contextWindowCompression: {
            triggerTokens: 104857,
            slidingWindow: { targetTokens: 52428 },
          } as any,
        },
        callbacks: {
          onopen: () => {
            log("NARRATION", "Connected");
          },
          onmessage: (message: any) => {
            // Wait for setup_complete before marking as ready to send
            if (message.setupComplete != null && !this.connected) {
              this.connected = true;
              log("NARRATION", "Setup complete — ready to send");
            }
            this.handleMessage(message);
          },
          onerror: (error: any) => {
            log("NARRATION", "Error", error?.message || error);
          },
          onclose: (event: any) => {
            log("NARRATION", "Disconnected", `code=${event?.code} reason=${event?.reason || "unknown"}`);
            this.connected = false;

            if (this.intentionallyClosed) {
              log("NARRATION", "Closed intentionally, skipping reconnect");
              return;
            }

            if (!this.disconnecting) {
              this.scheduleReconnect();
            }
          },
        },
      });
    } catch (err) {
      console.error("Narration connection failed:", err);
    }
  }

  private handleMessage(message: any): void {
    if (this.muted) return;

    // Audio output — queue for playback
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          this.audioManager.queuePlayback(part.inlineData.data);
        }
      }
    }

    // Transcription — show in UI and log
    if (message.serverContent?.outputTranscription?.text) {
      const text = message.serverContent.outputTranscription.text;
      log("NARRATION", `Said: ${text}`);
      this.onTranscript(text);
    }

    // Turn complete — start a new transcript line for next thought
    if (message.serverContent?.turnComplete) {
      this.onTurnDone();
    }
  }

  /**
   * Send a Claude activity event for narration.
   * Events are batched to avoid overwhelming the narrator.
   */
  sendEvent(description: string): void {
    if (!this.session || !this.connected || this.muted) return;

    this.eventBuffer.push(description);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushEvents();
      }, this.FLUSH_DELAY_MS);
    }
  }

  /**
   * Flush all buffered events as a single message to the narrator.
   */
  private flushEvents(): void {
    this.flushTimer = null;
    if (!this.session || this.eventBuffer.length === 0 || this.muted) {
      this.eventBuffer = [];
      return;
    }

    const message = this.eventBuffer.join("\n");
    this.eventBuffer = [];

    try {
      this.session.sendRealtimeInput({ text: message });
      log("NARRATION", `Sent update: ${message.slice(0, 120)}`);
    } catch (err) {
      log("NARRATION", `Error sending: ${err}`);
    }
  }

  /**
   * Send an immediate message (not batched). Use for important events
   * like "Claude started working" or "Task complete".
   */
  sendImmediate(text: string): void {
    if (!this.session || !this.connected || this.muted) return;

    // Flush any pending events first
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.eventBuffer.length > 0) {
      text = this.eventBuffer.join("\n") + "\n" + text;
      this.eventBuffer = [];
    }

    try {
      this.session.sendRealtimeInput({ text });
      log("NARRATION", `Sent immediate: ${text.slice(0, 120)}`);
    } catch (err) {
      log("NARRATION", `Error sending: ${err}`);
    }
  }

  /**
   * Mute narration and clear any queued audio.
   * Call this before main Gemini is about to speak.
   */
  silence(): void {
    this.muted = true;
    this.eventBuffer = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.audioManager.clearPlayback();
    log("NARRATION", "Silenced");
  }

  /**
   * Unmute narration. Call when main Gemini enters function call wait.
   */
  unmute(): void {
    this.muted = false;
    log("NARRATION", "Unmuted");
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    log("NARRATION", "Reconnecting in 5s...");
    setTimeout(async () => {
      await this.connect();
    }, 5000);
  }

  async disconnect(): Promise<void> {
    this.disconnecting = true;
    this.intentionallyClosed = true;
    this.muted = true;
    this.eventBuffer = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // Already closed
      }
      this.session = null;
    }
    this.connected = false;
  }
}
