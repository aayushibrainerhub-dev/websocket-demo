# apps/services/tts.py

import asyncio
import base64
import os
import subprocess
import tempfile


BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.dirname(
            os.path.abspath(__file__)
        )
    )
)


PIPER_BIN = os.path.join(
    BASE_DIR,
    ".venv",
    "bin",
    "piper",
)


VOICE_MODEL = os.path.join(
    BASE_DIR,
    "voices",
    "en_US-lessac-medium.onnx",
)


def speak(text: str) -> bytes:

    text = text.strip()

    if not text:
        raise ValueError(
            "Text cannot be empty."
        )

    if not os.path.exists(PIPER_BIN):
        raise FileNotFoundError(
            f"Piper executable not found: {PIPER_BIN}"
        )

    if not os.path.exists(VOICE_MODEL):
        raise FileNotFoundError(
            f"Piper voice model not found: {VOICE_MODEL}"
        )


    with tempfile.NamedTemporaryFile(
        suffix=".wav",
        delete=False,
    ) as f:

        output_path = f.name


    try:

        subprocess.run(
            [
                PIPER_BIN,
                "-m",
                VOICE_MODEL,
                "-f",
                output_path,
            ],
            input=text.encode("utf-8"),
            check=True,
            capture_output=True,
        )


        with open(
            output_path,
            "rb",
        ) as f:

            return f.read()


    finally:

        if os.path.exists(
            output_path
        ):

            os.remove(
                output_path
            )


def speak_base64(
    text: str,
) -> str:

    audio = speak(text)

    return base64.b64encode(
        audio
    ).decode("utf-8")


async def generate_tts(
    text: str,
) -> str:
    """
    Run Piper in a background thread so
    FastAPI's event loop is not blocked.

    Returns:
        Base64 encoded WAV audio.
    """

    audio_bytes = await asyncio.to_thread(
        speak,
        text,
    )

    return base64.b64encode(
        audio_bytes
    ).decode("utf-8")