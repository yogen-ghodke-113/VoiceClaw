import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), http_options={'api_version': 'v1alpha'})

print("Listing all models in v1alpha:")
for m in client.models.list():
    print(f"Name: {m.name}, Actions: {m.supported_actions}")
