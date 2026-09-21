from pydantic import BaseModel, ConfigDict


class Credentials(BaseModel):
    username: str
    password: str


class MessageCreate(BaseModel):
    content: str