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
    lowered = text.lower().strip()
    for spoken, symbol in _SPOKEN_REPLACEMENTS.items():
        lowered = lowered.replace(spoken, symbol)
    # Collapse any leftover spaces only around the substituted symbols
    lowered = re.sub(r"\s*(@|\.(?=\S)|_|-)\s*", r"\1", lowered)
    return lowered


SYSTEM_PROMPT = """You are a voice command parser for a chat and calling application.
Always respond with valid JSON only — no markdown, no explanation.

Supported actions:
1. "send_message" — when user wants to send/say/tell a chat message.
2. "call_user" — when user wants to call, video call, voice call, or audio call someone.

Fields to extract:
- action: "send_message" or "call_user"
- receiver: the name or username of the recipient exactly as spoken (e.g. "rishi", "rishi pandey", "aayushi", "aayushi shah")
- message: exact message to send (only for send_message)
- call_type: "video" (for video calls), "audio" (for audio / voice calls), or "unspecified" (if user simply says "call someone")

Examples:
Input: "message rishi saying hey how are you"
Output: {"action": "send_message", "receiver": "rishi", "message": "hey how are you", "call_type": null}

Input: "send a message to rishi pandey saying I will come tomorrow"
Output: {"action": "send_message", "receiver": "rishi pandey", "message": "I will come tomorrow", "call_type": null}

Input: "call aayushi"
Output: {"action": "call_user", "receiver": "aayushi", "message": null, "call_type": "unspecified"}

Input: "make a video call to aayushi shah"
Output: {"action": "call_user", "receiver": "aayushi shah", "message": null, "call_type": "video"}

Input: "start an audio call with alex"
Output: {"action": "call_user", "receiver": "alex", "message": null, "call_type": "audio"}

Input: "video call rishi"
Output: {"action": "call_user", "receiver": "rishi", "message": null, "call_type": "video"}

Input: "voice call priya"
Output: {"action": "call_user", "receiver": "priya", "message": null, "call_type": "audio"}

Rules:
- Never invent names or message content.
- Output raw JSON only."""


async def parse_command(text: str) -> VoiceCommand:
    normalized = normalize_transcript(text)
    result = await structured_llm.ainvoke(
        f"{SYSTEM_PROMPT}\n\nUser voice command: {normalized}"
    )
    return result