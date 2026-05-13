import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

def test():
    client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
    print("Testing gemini-2.0-flash...")
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents='Hello, are you there?'
        )
        print("Response:", response.text)
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test()
