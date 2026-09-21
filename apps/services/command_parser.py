import json
import os
import re

from langchain_groq import ChatGroq

from apps.models.voice import VoiceCommand


llm = ChatGroq(
    model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    api_key=os.getenv("GROQ_API_KEY"),
    temperature=0,
)

structured_llm = llm.with_structured_output(VoiceCommand, method="json_mode")


_SPOKEN_REPLACEMENTS = {
    " at the rate ": "@",
    " at ": "@",
    " dot ": ".",
    " underscore ": "_",
    " hyphen ": "-",
    " dash ": "-",
}


def normalize_transcript(text: str) -> str:
    """Normalize spoken artifacts from Whisper output before LLM parsing.
    Converts spoken email/username patterns like 'alice at gmail dot com'
    into their symbolic form 'alice@gmail.com'.
    """
    lowered = text.lower().strip()
    for spoken, symbol in _SPOKEN_REPLACEMENTS.items():
        lowered = lowered.replace(spoken, symbol)
    # Collapse any leftover spaces only around the substituted symbols
    lowered = re.sub(r"\s*(@|\.(?=\S)|_|-)\s*", r"\1", lowered)
    return lowered


SYSTEM_PROMPT = """You are a voice command parser for a chat application.
Always respond with valid JSON only — no markdown, no explanation.

Supported action: send_message

Extract:
- action: always "send_message"
- receiver: the name of the recipient exactly as spoken (e.g. "rishi", "rishi pandey", "aayushi shah")
- message: exact message to send

Examples:
Input: "message rishi saying hey how are you"
Output: {"action": "send_message", "receiver": "rishi", "message": "hey how are you"}

Input: "send a message to rishi pandey saying I will come tomorrow"
Output: {"action": "send_message", "receiver": "rishi pandey", "message": "I will come tomorrow"}

Input: "tell aayushi shah that the meeting is at 5"
Output: {"action": "send_message", "receiver": "aayushi shah", "message": "the meeting is at 5"}

Rules:
- Never invent names or message content.
- Output raw JSON only."""


async def parse_command(text: str) -> VoiceCommand:
    normalized = normalize_transcript(text)
    result = await structured_llm.ainvoke(
        f"{SYSTEM_PROMPT}\n\nUser voice command: {normalized}"
    )
    return result