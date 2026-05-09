import { AudioManager } from "./audio-manager";

interface WaveLayer {
  frequency: number;
  amplitude: number;
  phase: number;
  speed: number;
  color: string;
}

export class WaveRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audioManager: AudioManager;
  private layers: WaveLayer[] = [];
  private animationId: number | null = null;
  private inputDataArray: Uint8Array;
  private outputDataArray: Uint8Array;
  private smoothedLevel = 0;

  constructor(canvas: HTMLCanvasElement, audioManager: AudioManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.audioManager = audioManager;

    const fftSize = 256;
    this.inputDataArray = new Uint8Array(fftSize);
    this.outputDataArray = new Uint8Array(fftSize);

    // Initialize wave layers with Gemini-inspired colors
    // Colors: Blue (#4285F4), Purple (#9B72CB), Pink (#D96570), Cyan (#42C5F4)
    this.layers = [
      { frequency: 0.015, amplitude: 30, phase: 0, speed: 0.05, color: "rgba(66, 133, 244, 0.6)" },
      { frequency: 0.02, amplitude: 20, phase: 1, speed: 0.07, color: "rgba(155, 114, 203, 0.6)" },
      { frequency: 0.01, amplitude: 25, phase: 2, speed: 0.03, color: "rgba(217, 101, 112, 0.6)" },
      { frequency: 0.025, amplitude: 15, phase: 3, speed: 0.09, color: "rgba(66, 197, 244, 0.6)" },
    ];

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth;
      this.canvas.height = parent.clientHeight;
    }
  }

  start() {
    if (this.animationId) return;
    this.render();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private render() {
    this.animationId = requestAnimationFrame(() => this.render());

    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // Get audio data — compute average energy, not just max
    let inputEnergy = 0;
    let outputEnergy = 0;
    const inputAnalyser = this.audioManager.getInputAnalyser();
    const outputAnalyser = this.audioManager.getOutputAnalyser();

    if (inputAnalyser) {
      inputAnalyser.getByteFrequencyData(this.inputDataArray as any);
      for (let i = 0; i < this.inputDataArray.length; i++) {
        inputEnergy += this.inputDataArray[i];
      }
      inputEnergy /= this.inputDataArray.length;
    }

    if (outputAnalyser) {
      outputAnalyser.getByteFrequencyData(this.outputDataArray as any);
      for (let i = 0; i < this.outputDataArray.length; i++) {
        outputEnergy += this.outputDataArray[i];
      }
      outputEnergy /= this.outputDataArray.length;
    }

    // Normalize and apply noise gate (ignore low residual energy)
    const rawLevel = Math.max(inputEnergy, outputEnergy) / 255;
    const gatedLevel = rawLevel > 0.05 ? rawLevel : 0;

    // Smooth transitions — fast attack, slow decay
    const attackRate = 0.3;
    const decayRate = 0.05;
    if (gatedLevel > this.smoothedLevel) {
      this.smoothedLevel += (gatedLevel - this.smoothedLevel) * attackRate;
    } else {
      this.smoothedLevel += (gatedLevel - this.smoothedLevel) * decayRate;
    }

    const level = this.smoothedLevel;
    const targetAmplitudeMult = level * 1.5 + 0.1; // Base amplitude for idle "pulse"

    // Draw layers
    this.ctx.globalCompositeOperation = "screen";
    const centerY = height / 2;

    this.layers.forEach((layer) => {
      this.ctx.beginPath();
      this.ctx.moveTo(0, centerY);

      layer.phase += layer.speed;

      for (let x = 0; x < width; x++) {
        const y =
          centerY +
          Math.sin(x * layer.frequency + layer.phase) *
            layer.amplitude *
            targetAmplitudeMult *
            Math.sin((x / width) * Math.PI); // Taper edges

        this.ctx.lineTo(x, y);
      }

      // Create gradient for the layer
      const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, layer.color.replace("0.6", "0"));
      gradient.addColorStop(0.5, layer.color);
      gradient.addColorStop(1, layer.color.replace("0.6", "0"));

      this.ctx.strokeStyle = gradient;
      this.ctx.lineWidth = 4 + level * 10;
      this.ctx.lineCap = "round";
      this.ctx.stroke();

      // Add a subtle fill for the "blob" look
      this.ctx.lineTo(width, height);
      this.ctx.lineTo(0, height);
      const fillGradient = this.ctx.createLinearGradient(0, centerY - 50, 0, height);
      fillGradient.addColorStop(0, layer.color.replace("0.6", "0.2"));
      fillGradient.addColorStop(1, "transparent");
      this.ctx.fillStyle = fillGradient;
      this.ctx.fill();
    });
  }
}
