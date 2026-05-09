from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
    raise RuntimeError(
        f"Google AI Studio key is missing. Add GOOGLE_API_KEY=your_key_here to {ROOT_DIR / '.env'}"
    )

llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3)
