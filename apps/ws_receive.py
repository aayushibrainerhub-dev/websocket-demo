import hashlib
import hmac
import os
import re
import secrets
from rapidfuzz import fuzz
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from apps.models.schemas import Credentials, MessageCreate

from apps.models.database import SessionLocal, lifespan
from apps.models.model import Message, User
from apps.ws_service import ConnectionManager

import tempfile
from fastapi import UploadFile, File
from apps.services.stt import stt
from apps.services.command_parser import parse_command
from apps.services.tts import speak, generate_tts
from fastapi.responses import Response
from apps.services.confirmation import parse_confirmation


app = FastAPI(lifespan=lifespan)
manager = ConnectionManager()
voice_sessions = {}
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "templates", "static")), name="static")
JWT_SECRET = os.getenv("JWT_SECRET", "development-only-change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt_hex, digest_hex = stored_hash.split(":")
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt_hex), 120_000
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


def validate_credentials(credentials: Credentials) -> str:
    username = credentials.username.strip()
    if len(username) < 2 or len(username) > 50:
        raise HTTPException(400, "Username must be 2 to 50 characters")
    if len(credentials.password) < 6:
        raise HTTPException(400, "Password must contain at least 6 characters")
    return username


async def create_session(user: User):
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    token = jwt.encode(
        {"sub": str(user.id), "username": user.username, "exp": expires_at},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {"user_id": user.id, "username": user.username, "access_token": token}


async def authenticated_user(authorization: str | None) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Authentication required")
    user_id = get_user_id_from_token(authorization.split(" ", 1)[1])
    async with SessionLocal() as session:
        user = await session.get(User, user_id) if user_id is not None else None
        if user is None:
            raise HTTPException(401, "Invalid session")
        return user


@app.post("/register")
async def register(credentials: Credentials):
    username = validate_credentials(credentials)
    username_key = username.lower()
    async with SessionLocal() as session:
        result = await session.execute(
            select(User).where(User.username == username_key)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(409, "Username is already registered")

        user = User(username=username_key, password_hash=hash_password(credentials.password))
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return await create_session(user)


@app.post("/login")
async def login(credentials: Credentials):
    username = credentials.username.strip().lower()
    async with SessionLocal() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None or not verify_password(credentials.password, user.password_hash):
            raise HTTPException(401, "Invalid username or password")
        return await create_session(user)


def get_user_id_from_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError):
        return None
    return user_id


@app.get("/api/me")
async def current_user(authorization: str | None = Header(default=None)):
    user = await authenticated_user(authorization)
    return {"id": user.id, "username": user.username}


@app.get("/api/users")
async def users(
    search: str = "",
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    normalized_search = search.strip().lower()
    async with SessionLocal() as session:
        query = select(User).where(User.id != user.id).order_by(User.username).limit(50)
        if normalized_search:
            query = query.where(User.username.contains(normalized_search))
        result = await session.execute(query)
        return [{"id": item.id, "username": item.username} for item in result.scalars()]


@app.get("/api/messages/{other_user_id}")
async def message_history(
    other_user_id: int,
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    async with SessionLocal() as session:
        other_user = await session.get(User, other_user_id)
        if other_user is None or other_user.id == user.id:
            raise HTTPException(404, "User not found")
        result = await session.execute(
            select(Message, User.username)
            .join(User, User.id == Message.sender_id)
            .where(
                ((Message.sender_id == user.id) & (Message.receiver_id == other_user_id))
                | ((Message.sender_id == other_user_id) & (Message.receiver_id == user.id))
            )
            .order_by(Message.created_at, Message.id)
            .limit(200)
        )
        return [
            {
                "id": message.id,
                "sender_id": message.sender_id,
                "sender_username": username,
                "receiver_id": message.receiver_id,
                "content": message.content,
                "created_at": message.created_at.isoformat(),
            }
            for message, username in result.all()
        ]


@app.get("/")
async def chat_page():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))


@app.websocket("/ws/{receiver_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    receiver_id: int,
    token: str = Query(...),
):
    sender_id = get_user_id_from_token(token)
    async with SessionLocal() as session:
        sender = await session.get(User, sender_id) if sender_id is not None else None
        receiver = await session.get(User, receiver_id)

        if sender is None or receiver is None:
            await websocket.close(code=1008)
            return

        await manager.connect(sender.id, websocket)
        try:
            while True:
                payload = await websocket.receive_json()
                content = MessageCreate.model_validate(payload).content.strip()
                if not content or len(content) > 2000:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Message must be 1 to 2000 characters.",
                    })
                    continue

                chat_message = Message(
                    sender_id=sender.id,
                    receiver_id=receiver.id,
                    content=content,
                )
                session.add(chat_message)
                await session.commit()
                await session.refresh(chat_message)
                event = {
                    "type": "message",
                    "id": chat_message.id,
                    "sender_id": sender.id,
                    "sender_username": sender.username,
                    "receiver_id": receiver.id,
                    "content": content,
                    "created_at": chat_message.created_at.isoformat(),
                }
                await manager.send_message(receiver.id, event)
                await manager.send_message(sender.id, event)
        except WebSocketDisconnect:
            manager.disconnect(sender.id, websocket)



async def search_users_by_name(name: str, exclude_id: int):
    """Return all users whose username matches name via ILIKE chain, with fuzzy fallback."""
    normalized = re.sub(r"[^a-z0-9 ]", "", name.strip().lower()).strip()
    collapsed = re.sub(r"\s+", "", normalized)
    words = [w for w in normalized.split() if len(w) >= 3]
    seen_ids: set[int] = set()
    results: list[User] = []

    async with SessionLocal() as session:
        async def _query(condition):
            r = await session.execute(
                select(User).where(User.id != exclude_id).where(condition).limit(10)
            )
            for u in r.scalars():
                if u.id not in seen_ids:
                    seen_ids.add(u.id)
                    results.append(u)

        await _query(User.username.ilike(normalized))
        await _query(User.username.ilike(f"{normalized}%"))
        await _query(User.username.ilike(f"%{normalized}%"))
        if collapsed != normalized:
            await _query(User.username.ilike(f"%{collapsed}%"))
        for word in words:
            await _query(User.username.ilike(f"%{word}%"))

        # Fuzzy fallback: if ILIKE found nothing, score all users and return best matches
        if not results:
            all_users = (await session.execute(
                select(User).where(User.id != exclude_id)
            )).scalars().all()
            scored = [
                (u, max(fuzz.ratio(normalized, u.username),
                        fuzz.partial_ratio(normalized, u.username)))
                for u in all_users
            ]
            results = [u for u, score in sorted(scored, key=lambda x: -x[1]) if score >= 60]

    return results



@app.post("/api/voice-search")
async def voice_search(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    sender = await authenticated_user(authorization)

    suffix = os.path.splitext(audio.filename or ".webm")[1]

    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
    ) as f:
        f.write(await audio.read())
        temp_path = f.name

    try:
        # ---------------------------------------------------------
        # 1. Whisper -> speech to text
        # ---------------------------------------------------------
        text = stt.transcribe(temp_path).strip()

        if not text:
            tts_text = "I could not understand your voice command. Please try again."

            return {
                "success": False,
                "stage": "error",
                "transcribed_text": "",
                "tts_audio": await generate_tts(tts_text),
            }

        # ---------------------------------------------------------
        # 2. LLM -> extract receiver + message
        # ---------------------------------------------------------
        command = await parse_command(text)

        receiver_name = command.receiver.strip()
        message = command.message.strip()

        # ---------------------------------------------------------
        # 3. Search users
        # ---------------------------------------------------------
        matches = await search_users_by_name(
            receiver_name,
            exclude_id=sender.id,
        )

        users = [
            {
                "id": user.id,
                "username": user.username,
            }
            for user in matches
        ]

        # ---------------------------------------------------------
        # 4. No users
        # ---------------------------------------------------------
        if not users:
            tts_text = (
                f"I could not find a user named {receiver_name}. "
                "Please try again."
            )

            return {
                "success": False,
                "stage": "user_not_found",
                "transcribed_text": text,
                "receiver": receiver_name,
                "message": message,
                "users": [],
                "tts_audio": await generate_tts(tts_text),
            }

        # ---------------------------------------------------------
        # 5. One user -> go directly to confirmation
        # ---------------------------------------------------------
        if len(users) == 1:
            selected_user = users[0]

            tts_text = (
                f"I found {selected_user['username']}. "
                f"Are you sure you want to send "
                f"the message '{message}' to "
                f"{selected_user['username']}?"
            )

            return {
                "success": True,
                "stage": "confirmation",
                "transcribed_text": text,
                "receiver": receiver_name,
                "message": message,
                "users": users,
                "selected_user": selected_user,
                "tts_audio": await generate_tts(tts_text),
            }

        # ---------------------------------------------------------
        # 6. Multiple users -> ask for option
        # ---------------------------------------------------------
        lines = [
            f"Option {index + 1}. {user['username']}"
            for index, user in enumerate(users)
        ]

        tts_text = (
            "I found multiple users. "
            + ". ".join(lines)
            + ". "
            "Please say option 1, option 2, or the option number "
            "you want to select."
        )

        return {
            "success": True,
            "stage": "user_selection",
            "transcribed_text": text,
            "receiver": receiver_name,
            "message": message,
            "users": users,
            "selected_user": None,
            "tts_audio": await generate_tts(tts_text),
        }

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)



@app.post("/api/tts")
async def text_to_speech(
    payload: dict,
    authorization: str | None = Header(default=None),
):
    await authenticated_user(authorization)

    text = str(payload.get("text", "")).strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text is required."
        )

    audio = await generate_tts(text)

    return {
        "text": text,
        "tts_audio": audio,
    }

@app.post("/api/voice-select")
async def voice_select(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    await authenticated_user(authorization)

    suffix = os.path.splitext(audio.filename or ".webm")[1]

    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
    ) as f:
        f.write(await audio.read())
        temp_path = f.name

    try:
        # ---------------------------------------------------------
        # Whisper
        # ---------------------------------------------------------
        text = stt.transcribe(temp_path).strip().lower()

        if not text:
            return {
                "success": False,
                "selected_index": None,
                "transcribed_text": "",
            }

        # ---------------------------------------------------------
        # Extract option number
        # ---------------------------------------------------------
        ordinals = {
            "first": 1,
            "second": 2,
            "third": 3,
            "fourth": 4,
            "fifth": 5,
            "sixth": 6,
            "seventh": 7,
            "eighth": 8,
            "ninth": 9,
            "tenth": 10,

            "one": 1,
            "two": 2,
            "three": 3,
            "four": 4,
            "five": 5,
            "six": 6,
            "seven": 7,
            "eight": 8,
            "nine": 9,
            "ten": 10,
        }

        number = None

        # Examples:
        # option 1
        # option one
        # select option 2
        # choose option three
        match = re.search(
            r"(?:option|number|choice)\s+(\w+)",
            text,
        )

        if match:
            value = match.group(1)

            if value.isdigit():
                number = int(value)
            else:
                number = ordinals.get(value)

        # If "option" wasn't detected, look for a standalone number/word.
        if number is None:

            if text.isdigit():
                number = int(text)

            else:
                for word in text.split():
                    if word in ordinals:
                        number = ordinals[word]
                        break

                    if word.isdigit():
                        number = int(word)
                        break

        if number is None:
            return {
                "success": False,
                "selected_index": None,
                "transcribed_text": text,
                "error": "Could not understand option number.",
            }

        return {
            "success": True,
            "transcribed_text": text,
            "selected_index": number - 1,
        }

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)



@app.post("/api/voice-confirm")
async def voice_confirm(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    await authenticated_user(authorization)

    suffix = os.path.splitext(audio.filename or ".webm")[1]

    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
    ) as f:
        f.write(await audio.read())
        temp_path = f.name

    try:
        # ---------------------------------------------------------
        # Whisper
        # ---------------------------------------------------------
        text = stt.transcribe(temp_path).strip()

        # ---------------------------------------------------------
        # Confirmation parser
        # ---------------------------------------------------------
        confirmed = parse_confirmation(text)

        if confirmed is True:
            status = "confirmed"

        elif confirmed is False:
            status = "cancelled"

        else:
            status = "unknown"

        return {
            "success": True,
            "transcribed_text": text,
            "confirmed": confirmed,
            "status": status,
        }

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/voice-transcribe")
async def voice_transcribe(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Step 2: transcribe in-chat voice message, return raw text only."""
    await authenticated_user(authorization)
    suffix = os.path.splitext(audio.filename or ".wav")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(await audio.read())
        temp_path = f.name
    try:
        text = stt.transcribe(temp_path)
        return {"text": text}
    finally:
        os.remove(temp_path)