import os
import asyncio
from google import genai
from dotenv import load_dotenv

load_dotenv()

async def test_live():
    model_id = "gemini-3.1-flash-live-preview"
    print(f"Trying {model_id} with v1alpha...")
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), http_options={'api_version': 'v1alpha'})
    try:
        async with client.aio.live.connect(model=model_id, config={}) as session:
            print("Connected successfully!")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_live())
