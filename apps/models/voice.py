from typing import Literal

from pydantic import BaseModel


class VoiceCommand(BaseModel):
    action: Literal[
        "send_message",
        "find_user",
        "get_messages",
    ]

    receiver: str | None = None

    message: str | None = None