/**
 * NvidiaApiService — Client for NVIDIA APIs (NIM, Picasso, etc.)
 * 
 * Provides a clean interface for image generation and other NVIDIA services.
 * Uses the NVAPI key stored in environment variables.
 */

const NVIDIA_API_BASE = "https://api.nvidia.com/v1";
const NVIDIA_IMAGE_GEN_URL = `${NVIDIA_API_BASE}/imagen/picasso/generations`;

export interface ImageGenerationOptions {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  seed?: number;
  steps?: number;
}

export interface ImageGenerationResponse {
  images: string[]; // base64 encoded images
  nsfwContentDetected: boolean[];
  prompt: string;
}

export class NvidiaApiService {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("NVIDIA API key is required");
    }
    this.apiKey = apiKey;
  }

  /**
   * Generate an image using NVIDIA's Picasso API
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResponse> {
    const response = await fetch(NVIDIA_IMAGE_GEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: options.prompt,
        negative_prompt: options.negativePrompt || "",
        aspect_ratio: options.aspectRatio || "1:1",
        seed: options.seed || Math.floor(Math.random() * 1000000),
        steps: options.steps || 30,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NVIDIA API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      images: data.images || [],
      nsfwContentDetected: data.nsfwContentDetected || [],
      prompt: data.prompt || options.prompt,
    };
  }

  /**
   * Health check for the NVIDIA API
   */
  async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      const response = await fetch(`${NVIDIA_API_BASE}/health`, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });
      
      if (response.ok) {
        return { status: "ok", message: "NVIDIA API is reachable" };
      } else {
        return { status: "degraded", message: `NVIDIA API returned ${response.status}` };
      }
    } catch (error) {
      return { status: "unreachable", message: `NVIDIA API error: ${error}` };
    }
  }
}