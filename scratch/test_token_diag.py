import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from google import genai

load_dotenv()

def test_token():
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(
        api_key=api_key,
        http_options={"api_version": "v1alpha"},
    )

    now = datetime.now(tz=timezone.utc)
    try:
        print("Creating token in v1alpha...")
        token = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": (now + timedelta(minutes=30)).isoformat(),
                "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),
            }
        )
        print("Token created:", token.name)
    except Exception as e:
        print("v1alpha failed:", e)

    try:
        print("\nCreating token in v1beta...")
        client_beta = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1beta"},
        )
        token = client_beta.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": (now + timedelta(minutes=30)).isoformat(),
                "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),
            }
        )
        print("Token created:", token.name)
    except Exception as e:
        print("v1beta failed:", e)

if __name__ == "__main__":
    test_token()
