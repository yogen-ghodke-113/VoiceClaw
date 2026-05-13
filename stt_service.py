"""Accurate transcription via Gemini generateContent API (same API key)."""

import asyncio
import base64
import os
import struct
import traceback
from io import BytesIO

from google import genai


def transcribe_audio_sync(
    pcm_base64_chunks: list[str],
    language_code: str = "en-US",
) -> str:
    """Transcribe base64-encoded 16kHz 16-bit PCM audio via Gemini.

    Sync function — must be run in a thread from async context.
    Uses the same GEMINI_API_KEY — no extra credentials needed.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ""

    # Combine all PCM chunks into one buffer
    pcm_bytes = b""
    for chunk in pcm_base64_chunks:
        pcm_bytes += base64.b64decode(chunk)

    if len(pcm_bytes) < 1600:  # Less than 0.05s of audio
        return ""

    # Wrap raw PCM in WAV for Gemini
    wav_bytes = _pcm_to_wav(pcm_bytes, sample_rate=16000, bits_per_sample=16)
    audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")

    client = genai.Client(api_key=api_key)
    lang_name = _language_name(language_code)

    response = client.models.generate_content(
        model="gemini-2.0-flash-exp",
        contents=[
            {
                "parts": [
                    {
                        "text": (
                            f"Transcribe this audio exactly as spoken in {lang_name}. "
                            "Output ONLY the transcription text, nothing else. "
                            "No quotes, no labels, no explanations."
                        ),
                    },
                    {
                        "inline_data": {
                            "mime_type": "audio/wav",
                            "data": audio_b64,
                        },
                    },
                ],
            }
        ],
    )

    return (response.text or "").strip()


async def transcribe_audio(
    pcm_base64_chunks: list[str],
    language_code: str = "en-US",
) -> str:
    """Async wrapper — runs sync Gemini call in a thread to avoid blocking."""
    try:
        return await asyncio.to_thread(
            transcribe_audio_sync, pcm_base64_chunks, language_code
        )
    except Exception as e:
        traceback.print_exc()
        return ""


def _pcm_to_wav(
    pcm_data: bytes, sample_rate: int = 16000, bits_per_sample: int = 16
) -> bytes:
    """Wrap raw PCM bytes in a WAV header."""
    num_channels = 1
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_data)

    buf = BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))
    buf.write(struct.pack("<H", num_channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", byte_rate))
    buf.write(struct.pack("<H", block_align))
    buf.write(struct.pack("<H", bits_per_sample))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm_data)
    return buf.getvalue()


def _language_name(code: str) -> str:
    """Convert language code to name for the prompt."""
    names = {
        "en-US": "English",
        "hi-IN": "Hindi",
        "es-ES": "Spanish",
        "fr-FR": "French",
        "de-DE": "German",
        "ja-JP": "Japanese",
        "ko-KR": "Korean",
        "pt-BR": "Portuguese",
        "zh-CN": "Chinese",
        "ar-SA": "Arabic",
    }
    return names.get(code, "English")
