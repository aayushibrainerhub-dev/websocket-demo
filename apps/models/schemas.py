from pydantic import BaseModel, ConfigDict


class SendOtpRequest(BaseModel):
    email: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    otp: str


class LoginRequest(BaseModel):
    email: str | None = None
    username: str | None = None
    password: str


class Credentials(BaseModel):
    username: str
    password: str


class MessageCreate(BaseModel):
    content: str


class CreateGroupRequest(BaseModel):
    name: str
    member_ids: list[int]