"""Generate Gemini ephemeral tokens for browser-side Live API connections."""

import os
from datetime import datetime, timedelta, timezone

from google import genai


MODEL = "gemini-2.5-flash-native-audio-latest"


def create_ephemeral_token() -> dict:
    """Create a short-lived token safe for browser use."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set in environment")

    client = genai.Client(
        api_key=api_key,
        http_options={"api_version": "v1alpha"},
    )

    now = datetime.now(tz=timezone.utc)
    token = client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": (now + timedelta(minutes=30)).isoformat(),
            "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),
        }
    )

    return {"token": token.name}
