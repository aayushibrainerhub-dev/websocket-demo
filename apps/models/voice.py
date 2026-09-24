from typing import Literal

from pydantic import BaseModel


class VoiceCommand(BaseModel):
    action: Literal[
        "send_message",
        "call_user",
        "find_user",
        "get_messages",
    ]

    receiver: str | None = None

    message: str | None = None

    call_type: Literal["audio", "video", "unspecified"] | None = "unspecified"