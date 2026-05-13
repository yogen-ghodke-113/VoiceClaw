# NVIDIA API Integration

This module provides integration with NVIDIA's AI APIs (Picasso, NIM, etc.) for the VoiceClaw project.

## Features

- **Image Generation**: Generate images from text prompts using NVIDIA's Picasso API
- **Health Monitoring**: Check API status and connectivity
- **Error Handling**: Comprehensive error handling and logging
- **Type Safety**: Full TypeScript support

## Usage

```typescript
import { NvidiaApiService } from "./services/nvidia-api";

const nvidia = new NvidiaApiService("your-nvidia-api-key");

// Generate an image
const result = await nvidia.generateImage({
  prompt: "A futuristic cityscape at sunset",
  aspectRatio: "16:9",
  steps: 30,
});

// Check API health
const health = await nvidia.healthCheck();
console.log(health.status); // "ok", "degraded", or "unreachable"
```

## Configuration

Add your NVIDIA API key to the `.env` file:

```env
NVIDIA_API_KEY=your-api-key-here
```

## API Reference

### `NvidiaApiService`

#### Constructor

```typescript
constructor(apiKey: string)
```

- `apiKey`: Your NVIDIA API key

#### Methods

##### `generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResponse>`

Generates an image based on the provided prompt.

**Parameters:**

| Parameter | Type | Required | Description |
|------------|------|----------|-------------|
| `prompt` | `string` | Yes | The text prompt for image generation |
| `negativePrompt` | `string` | No | Things to avoid in the image |
| `aspectRatio` | `"1:1" \| "16:9" \| "9:16" \| "4:3" \| "3:4"` | No | Image aspect ratio (default: `"1:1"`) |
| `seed` | `number` | No | Random seed for reproducibility |
| `steps` | `number` | No | Number of generation steps (default: `30`) |

**Returns:**

```typescript
interface ImageGenerationResponse {
  images: string[];           // Base64-encoded image data
  nsfwContentDetected: boolean[];
  prompt: string;
}
```

##### `healthCheck(): Promise<{ status: string; message: string }>`

Checks if the NVIDIA API is accessible.

**Returns:**

```typescript
interface HealthCheckResponse {
  status: "ok" | "degraded" | "unreachable";
  message: string;
}
```

## Error Handling

The service throws descriptive errors for common issues:

- `NVIDIA API Key is required`: Missing API key
- `NVIDIA API Error (401): ...`: Authentication failed
- `NVIDIA API Error (429): ...`: Rate limit exceeded
- `NVIDIA API Error (500): ...`: Server error

## Security Considerations

1. **Never** commit your API key to version control
2. Use environment variables for API keys
3. The `.gitignore` file already excludes `.env` files
4. Consider implementing request signing for production use