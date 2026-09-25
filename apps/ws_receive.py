from requests import session
from livekit import api as livekit_api
import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from rapidfuzz import fuzz
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel
import redis.asyncio as aioredis
from sqlalchemy import select, func, case
from apps.models.schemas import (
    Credentials,
    MessageCreate,
    SendOtpRequest,
    RegisterRequest,
    LoginRequest,
    CreateGroupRequest,
)
import logging
from apps.models.database import SessionLocal, lifespan
from apps.models.model import Message, User, Group, GroupMember, GroupMessage
from apps.ws_service import ConnectionManager

import asyncio
import httpx
import tempfile
from fastapi import UploadFile, File
from apps.services.stt import stt
from apps.services.command_parser import parse_command
from apps.services.tts import speak, generate_tts
from fastapi.responses import Response
from apps.services.confirmation import parse_confirmation
from apps.services.email_service import send_otp_email


logger = logging.getLogger(__name__)
from apps.services.email_service import send_otp_email


logger = logging.getLogger(__name__)

app = FastAPI(lifespan=lifespan)
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "")
manager = ConnectionManager()
voice_sessions = {}
call_reports: dict = {}
MAX_CALL_REPORTS = 200
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "templates", "static")), name="static")
JWT_SECRET = os.getenv("JWT_SECRET", "development-only-change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)

# LiveKit SFU configuration
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

# Signaling types – legacy P2P kept for backwards compat + new LiveKit group call signals
CALL_SIGNAL_TYPES = {
    "call_offer",
    "call_answer",
    "call_ice",
    "call_reject",
    "call_end",
    # LiveKit group call signals
    "call_invite",
    "call_leave",
}


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


def format_username(name: str) -> str:
    if not name:
        return ""
    if "@" in name:
        return name.split("@")[0].strip()
    return name.strip()


async def create_session(user: User):
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    clean_username = format_username(user.username)
    token = jwt.encode(
        {"sub": str(user.id), "username": clean_username, "exp": expires_at},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {
        "user_id": user.id,
        "username": clean_username,
        "email": user.email,
        "access_token": token,
    }


async def authenticated_user(authorization: str | None) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Authentication required")
    user_id = get_user_id_from_token(authorization.split(" ", 1)[1])
    async with SessionLocal() as session:
        user = await session.get(User, user_id) if user_id is not None else None
        if user is None:
            raise HTTPException(401, "Invalid session")
        return user

def validate_email(email: str) -> str:
    clean_email = email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean_email):
        raise HTTPException(400, "Invalid email address format")
    return clean_email


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@app.post("/auth/send-otp")
# @app.post("/api/auth/send-otp")
async def send_otp(request: SendOtpRequest):
    email = validate_email(request.email)
    async with SessionLocal() as session:
        result = await session.execute(
            select(User).where(func.lower(User.email) == email)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(400, "This email is already registered")

    otp = generate_otp()
    try:
        # Store in Redis with 5-minute (300s) TTL
        await redis_client.set(f"otp:{email}", otp, ex=300)
    except Exception as e:
        print(f"Redis error storing OTP: {e}")
        raise HTTPException(500, "Failed to connect to Redis to store OTP")

    print(f"[*] Generated OTP for {email}: {otp}")

    # Send email using HTML template
    try:
        await send_otp_email(email, otp)
    except Exception as e:
        await redis_client.delete(f"otp:{email}")
        print(f"[EMAIL SEND ERROR] {e}")
        raise HTTPException(500, detail=str(e))

    return {
        "status": "success",
        "message": f"Verification code sent to {email}. Please check your inbox.",
    }


@app.post("/register")
async def register(request: RegisterRequest):
    username = request.username.strip()
    if "@" in username:
        username = username.split("@")[0].strip()

    if len(username) < 2 or len(username) > 50:
        raise HTTPException(400, "Username must be 2 to 50 characters")
    if len(request.password) < 6:
        raise HTTPException(400, "Password must contain at least 6 characters")

    email = validate_email(request.email)
    otp = request.otp.strip() if request.otp else ""
    if len(otp) != 6:
        raise HTTPException(400, "Please enter a valid 6-digit OTP")

    try:
        stored_otp = await redis_client.get(f"otp:{email}")
    except Exception as e:
        print(f"Redis error checking OTP: {e}")
        raise HTTPException(500, "OTP verification service unavailable")

    if not stored_otp or stored_otp != otp:
        raise HTTPException(400, "Invalid or expired OTP. Please try again.")

    username_key = username.lower()
    async with SessionLocal() as session:
        result_user = await session.execute(
            select(User).where(func.lower(User.username) == username_key)
        )
        if result_user.scalar_one_or_none() is not None:
            raise HTTPException(409, "Username is already registered")

        result_email = await session.execute(
            select(User).where(func.lower(User.email) == email)
        )
        if result_email.scalar_one_or_none() is not None:
            raise HTTPException(409, "Email is already registered")

        # OTP verified, remove from Redis
        await redis_client.delete(f"otp:{email}")

        user = User(
            username=username,
            email=email,
            password_hash=hash_password(request.password),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return await create_session(user)


@app.post("/login")
async def login(request: LoginRequest):
    identifier = (request.email or request.username or "").strip().lower()
    if not identifier:
        raise HTTPException(400, "Email is required for login")
    if not request.password:
        raise HTTPException(400, "Password is required")

    async with SessionLocal() as session:
        result = await session.execute(
            select(User).where(func.lower(User.email) == identifier)
        )
        user = result.scalar_one_or_none()

        # Fallback to username for legacy accounts
        if user is None:
            result = await session.execute(
                select(User).where(func.lower(User.username) == identifier)
            )
            user = result.scalar_one_or_none()

        if user is None or not verify_password(request.password, user.password_hash):
            raise HTTPException(401, "Invalid email or password")
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
    return {
        "id": user.id,
        "username": format_username(user.username),
        "email": user.email,
    }


@app.get("/api/users")
async def users(
    search: str = "",
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    normalized_search = search.strip().lower()
    async with SessionLocal() as session:
        if normalized_search:
            query = (
                select(User)
                .where(User.id != user.id)
                .where(func.lower(User.username).contains(normalized_search))
                .order_by(User.username)
                .limit(50)
            )
        else:
            interacted_user_ids = (
                select(
                    case(
                        (Message.sender_id == user.id, Message.receiver_id),
                        else_=Message.sender_id,
                    ).label("other_user_id"),
                    func.max(Message.created_at).label("last_message_at"),
                )
                .where((Message.sender_id == user.id) | (Message.receiver_id == user.id))
                .group_by("other_user_id")
                .subquery()
            )

            query = (
                select(User)
                .join(interacted_user_ids, User.id == interacted_user_ids.c.other_user_id)
                .order_by(interacted_user_ids.c.last_message_at.desc())
                .limit(50)
            )
        result = await session.execute(query)
        user_list = result.scalars().all()
        return [{"id": item.id, "username": item.username, "email": item.email} for item in user_list]


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


@app.post("/api/groups")
async def create_group(
    body: CreateGroupRequest,
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Group name is required")

    member_ids = set(body.member_ids)
    member_ids.add(user.id)

    async with SessionLocal() as session:
        r = await session.execute(select(User).where(User.id.in_(member_ids)))
        valid_users = r.scalars().all()
        if len(valid_users) < 2:
            raise HTTPException(400, "A group must have at least 2 members")

        new_group = Group(name=name, created_by=user.id)
        session.add(new_group)
        await session.commit()
        await session.refresh(new_group)

        for u in valid_users:
            gm = GroupMember(group_id=new_group.id, user_id=u.id)
            session.add(gm)
        await session.commit()

        members_data = [{"id": u.id, "username": u.username, "email": u.email} for u in valid_users]
        return {
            "id": new_group.id,
            "name": new_group.name,
            "created_by": new_group.created_by,
            "created_at": new_group.created_at.isoformat(),
            "members": members_data,
        }


@app.get("/api/groups")
async def get_user_groups(
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    async with SessionLocal() as session:
        q = (
            select(Group)
            .join(GroupMember, Group.id == GroupMember.group_id)
            .where(GroupMember.user_id == user.id)
            .order_by(Group.created_at.desc())
        )
        groups_res = (await session.execute(q)).scalars().all()

        results = []
        for g in groups_res:
            mq = (
                select(User)
                .join(GroupMember, User.id == GroupMember.user_id)
                .where(GroupMember.group_id == g.id)
            )
            members = (await session.execute(mq)).scalars().all()
            results.append({
                "id": g.id,
                "name": g.name,
                "created_by": g.created_by,
                "created_at": g.created_at.isoformat(),
                "members": [{"id": u.id, "username": u.username, "email": u.email} for u in members],
            })
        return results


@app.get("/api/groups/{group_id}/messages")
async def get_group_messages(
    group_id: int,
    authorization: str | None = Header(default=None),
):
    user = await authenticated_user(authorization)
    async with SessionLocal() as session:
        chk = await session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user.id)
        )
        if chk.scalar_one_or_none() is None:
            raise HTTPException(403, "Not a member of this group")

        q = (
            select(GroupMessage, User.username)
            .join(User, User.id == GroupMessage.sender_id)
            .where(GroupMessage.group_id == group_id)
            .order_by(GroupMessage.created_at.asc(), GroupMessage.id.asc())
            .limit(200)
        )
        res = (await session.execute(q)).all()
        return [
            {
                "id": msg.id,
                "group_id": group_id,
                "sender_id": msg.sender_id,
                "sender_username": username,
                "content": msg.content,
                "created_at": msg.created_at.isoformat(),
            }
            for msg, username in res
        ]


@app.websocket("/ws/group/{group_id}")
async def group_websocket_endpoint(
    websocket: WebSocket,
    group_id: int,
    token: str = Query(...),
):
    sender_id = get_user_id_from_token(token)
    async with SessionLocal() as session:
        sender = await session.get(User, sender_id) if sender_id is not None else None
        if sender is None:
            await websocket.close(code=1008)
            return

        chk = await session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == sender.id)
        )
        if chk.scalar_one_or_none() is None:
            await websocket.close(code=1008)
            return

    await manager.connect(sender.id, websocket)
    try:
        while True:
            payload = await websocket.receive_json()
            if await relay_call_signal(payload, sender.id, None):
                continue

            content = MessageCreate.model_validate(payload).content.strip()
            if not content or len(content) > 2000:
                await websocket.send_json({
                    "type": "error",
                    "message": "Message must be 1 to 2000 characters.",
                })
                continue

            async with SessionLocal() as session:
                group_msg = GroupMessage(
                    group_id=group_id,
                    sender_id=sender.id,
                    content=content,
                )
                session.add(group_msg)
                await session.commit()
                await session.refresh(group_msg)

                mq = select(GroupMember.user_id).where(GroupMember.group_id == group_id)
                member_ids = (await session.execute(mq)).scalars().all()

                event = {
                    "type": "group_message",
                    "id": group_msg.id,
                    "group_id": group_id,
                    "sender_id": sender.id,
                    "sender_username": sender.username,
                    "content": content,
                    "created_at": group_msg.created_at.isoformat(),
                }
                for mid in member_ids:
                    await manager.send_message(mid, event)
    except WebSocketDisconnect:
        manager.disconnect(sender.id, websocket)


@app.get("/")
async def chat_page():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))


async def relay_call_signal(payload: dict, sender_id: int, default_target_id: int | None) -> bool:
    signal_type = payload.get("type")
    if signal_type not in CALL_SIGNAL_TYPES:
        return False

    # call_invite: broadcast to multiple target_ids (group call)
    if signal_type == "call_invite":
        target_ids = payload.get("target_ids", [])
        # also support a single target_id for backwards compat
        single = payload.get("target_id")
        if single is not None:
            try:
                target_ids = list(target_ids) + [int(single)]
            except (TypeError, ValueError):
                pass
        event = {
            "type": "call_invite",
            "sender_id": sender_id,
            "sender_username": payload.get("sender_username"),
            "sender_email": payload.get("sender_email", ""),
            "room_name": payload.get("room_name", ""),
            "participant_names": payload.get("participant_names", []),
            "group_name": payload.get("group_name", ""),
        }
        for tid in target_ids:
            try:
                tid = int(tid)
            except (TypeError, ValueError):
                continue
            if tid != sender_id:
                await manager.send_message(tid, event)
        return True

    # call_leave: notify single peer that sender left a LiveKit room
    if signal_type == "call_leave":
        target_id = payload.get("target_id", default_target_id)
        try:
            target_id = int(target_id)
        except (TypeError, ValueError):
            return True
        event = {
            "type": "call_leave",
            "sender_id": sender_id,
            "sender_username": payload.get("sender_username"),
            "room_name": payload.get("room_name", ""),
        }
        if target_id != sender_id:
            await manager.send_message(target_id, event)
        return True

    # Legacy P2P signals (call_offer, call_answer, call_ice, call_reject, call_end)
    target_id = payload.get("target_id", default_target_id)
    try:
        target_id = int(target_id)
    except (TypeError, ValueError):
        return True

    if target_id == sender_id:
        return True

    event = {
        "type": signal_type,
        "sender_id": sender_id,
        "sender_username": payload.get("sender_username"),
        "receiver_id": target_id,
        "sdp": payload.get("sdp"),
        "candidate": payload.get("candidate"),
    }
    await manager.send_message(target_id, event)
    return True


@app.websocket("/ws/signal")
async def signaling_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    user_id = get_user_id_from_token(token)
    async with SessionLocal() as session:
        user = await session.get(User, user_id) if user_id is not None else None
        if user is None:
            await websocket.close(code=1008)
            return
        user_pk = user.id

    await manager.connect(user_pk, websocket)
    try:
        while True:
            payload = await websocket.receive_json()
            await relay_call_signal(payload, user_pk, payload.get("target_id"))
    except WebSocketDisconnect:
        manager.disconnect(user_pk, websocket)


class LiveKitTokenRequest(BaseModel):
    room_name: str = ""


@app.post("/api/livekit/token")
async def livekit_token(
    body: LiveKitTokenRequest,
    authorization: str | None = Header(default=None),
):
    """
    Issue a LiveKit access token for the authenticated user.
    Accepts an optional room_name; generates a UUID room if not provided.
    Returns the JWT token, the LiveKit server URL, and the room name.
    """
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(503, "LiveKit is not configured on the server.")

    user = await authenticated_user(authorization)
    print("user---------------->", user)

    room = body.room_name.strip() or str(uuid.uuid4())
    print("room---------------->", room)

    token = (
        livekit_api.AccessToken(
            LIVEKIT_API_KEY,
            LIVEKIT_API_SECRET,
        )
        .with_identity(str(user.id))
        .with_name(format_username(user.username))
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room,
            )
        )
        .to_jwt()
    )

    return {
        "token": token,
        "server_url": LIVEKIT_URL,
        "room_name": room,
    }


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
                if await relay_call_signal(payload, sender.id, receiver.id):
                    continue
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


        command = await parse_command(text)

        action = command.action or "send_message"
        receiver_name = (command.receiver or "").strip()
        message = (command.message or "").strip()
        call_type = command.call_type or "unspecified"

        matches = await search_users_by_name(
            receiver_name,
            exclude_id=sender.id,
        )

        users = [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email or "",
            }
            for user in matches
        ]

        if not users:
            tts_text = (
                f"I could not find a user named {receiver_name}. "
                "Please try again."
            )

            return {
                "success": False,
                "stage": "user_not_found",
                "action": action,
                "call_type": call_type,
                "transcribed_text": text,
                "receiver": receiver_name,
                "message": message,
                "users": [],
                "tts_audio": await generate_tts(tts_text),
            }

        if len(users) == 1:
            selected_user = users[0]

            if action == "call_user":
                tts_text = f"I found {selected_user['username']}. Would you like an audio call or a video call?"
                return {
                    "success": True,
                    "stage": "call_options",
                    "action": action,
                    "call_type": call_type,
                    "transcribed_text": text,
                    "receiver": receiver_name,
                    "message": message,
                    "users": users,
                    "selected_user": selected_user,
                    "tts_audio": await generate_tts(tts_text),
                }

            tts_text = (
                f"I found {selected_user['username']}. "
                f"Are you sure you want to send "
                f"the message '{message}' to "
                f"{selected_user['username']}?"
            )

            return {
                "success": True,
                "stage": "confirmation",
                "action": action,
                "call_type": call_type,
                "transcribed_text": text,
                "receiver": receiver_name,
                "message": message,
                "users": users,
                "selected_user": selected_user,
                "tts_audio": await generate_tts(tts_text),
            }

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
            "action": action,
            "call_type": call_type,
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


async def _transcribe_upload(upload: UploadFile | None) -> str:
    """Save upload to temp file, transcribe, clean up."""
    if upload is None:
        return ""
    content = await upload.read()
    if not content:
        return ""
    suffix = os.path.splitext(upload.filename or ".webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(content)
        temp_path = f.name
    try:
        return await asyncio.to_thread(stt.transcribe, temp_path)
    except Exception as exc:
        print(f"[call-summary] transcribe error: {exc}")
        return ""
    finally:
        os.remove(temp_path)


@app.post("/api/call-summary")
async def call_summary(
    authorization: str | None = Header(default=None),
    local_audio: UploadFile | None = File(default=None),
    remote_audio: UploadFile | None = File(default=None),
    peer_name: str = "",
    my_name: str = "",
    call_start: str = "",
    call_end: str = "",
    call_events: str = "",
    target_email: str = "",
    caller_email: str = "",
    receiver_email: str = "",
):
    """
    Receives local + remote audio blobs from the browser after a video call ends.
    Transcribes both using Whisper (faster-whisper), then forwards an enriched
    JSON payload to the n8n webhook for OpenAI summarisation + Gmail delivery.
    """
    user = await authenticated_user(authorization)

    # Transcribe both sides concurrently
    local_text, remote_text = await asyncio.gather(
        _transcribe_upload(local_audio),
        _transcribe_upload(remote_audio),
    )

    my_display = my_name or user.username
    peer_display = peer_name or "Peer"
    my_mail = caller_email or user.email or ""
    rec_mail = receiver_email or ""
    email_destination = target_email or rec_mail or my_mail

    print(f"[call-summary] Caller: {my_display} ({my_mail}) -> Receiver: {peer_display} ({rec_mail}) | Sending summary to: {email_destination}")

    # Build readable interleaved transcript
    transcript_lines = []
    if local_text:
        transcript_lines.append(f"{my_display}: {local_text}")
    if remote_text:
        transcript_lines.append(f"{peer_display}: {remote_text}")
    full_transcript = "\n".join(transcript_lines)
    if not full_transcript.strip():
        full_transcript = "(No speech detected in the call recording)"

    # ── Derived fields for the OpenAI prompt ──────────────────────────
    call_id = str(uuid.uuid4())

    # Duration
    duration_str = "Not available"
    try:
        from datetime import datetime as _dt
        fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
        t_start = _dt.strptime(call_start.replace("Z", "Z"), fmt) if call_start else None
        t_end   = _dt.strptime(call_end.replace("Z", "Z"),   fmt) if call_end   else None
        if t_start and t_end:
            delta = t_end - t_start
            total_sec = int(delta.total_seconds())
            mins, secs = divmod(total_sec, 60)
            duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"
    except Exception:
        pass

    # Participants list
    participants = [
        {"name": my_display,   "email": my_mail,  "role": "caller"},
        {"name": peer_display, "email": rec_mail, "role": "receiver"},
    ]

    important_events = []
    try:
        if call_events:
            important_events = json.loads(call_events)
    except Exception:
        pass

    if not important_events:
        # Synthesise minimal events from what we know
        if call_start:
            important_events.append({"time": call_start, "event": "Call started",
                                     "participant": my_display})
            important_events.append({"time": call_start, "event": "Participant joined",
                                     "participant": my_display})
            important_events.append({"time": call_start, "event": "Participant joined",
                                     "participant": peer_display})
        if call_end:
            important_events.append({"time": call_end, "event": "Call ended",
                                     "participant": my_display})

    payload = {
        # ── Identity & timing ──────────────────────────────────────────
        "call_id":         call_id,
        "caller":          my_display,
        "caller_email":    my_mail,
        "receiver":        peer_display,
        "receiver_email":  rec_mail,
        "email":           email_destination,
        "to_email":        email_destination,
        "participants":    participants,
        "call_start":      call_start or "Not available",
        "call_end":        call_end   or "Not available",
        "call_duration":   duration_str,
        # ── Content ────────────────────────────────────────────────────
        "local_transcript":  local_text  or "(no speech)",
        "remote_transcript": remote_text or "(no speech)",
        "full_transcript":   full_transcript,
        # ── Events (for Important Events section of the prompt) ────────
        "important_events": important_events,
        # ── Scaffold for OpenAI to fill in ─────────────────────────────
        "decisions":    [],
        "action_items": [],
        "technical_issues": [],
    }

    # ── Store report so n8n can fetch it via GET /api/calls/{call_id}/report-data ──
    if len(call_reports) >= MAX_CALL_REPORTS:
        # Evict the oldest entry
        oldest_key = next(iter(call_reports))
        del call_reports[oldest_key]
    call_reports[call_id] = payload

    print(
        f"[call-summary] Stored report id={call_id} | "
        f"caller={my_display} peer={peer_display} duration={duration_str}"
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            n8n_resp = await client.post(N8N_WEBHOOK_URL, json=payload)
        n8n_resp.raise_for_status()
        print(f"[call-summary] n8n responded: {n8n_resp.status_code}")
    except httpx.HTTPStatusError as e:
        print(f"[call-summary] n8n HTTP error: {e.response.status_code} {e.response.text}")
        raise HTTPException(502, f"n8n returned {e.response.status_code}")
    except Exception as e:
        print(f"[call-summary] n8n request failed: {e}")
        raise HTTPException(502, "Could not reach n8n webhook")

    return {
        "ok":           True,
        "call_id":      call_id,
        "caller":       my_display,
        "receiver":     peer_display,
        "duration":     duration_str,
        "transcript":   full_transcript,
        "n8n_status":   n8n_resp.status_code,
    }


@app.get("/api/calls/{call_id}/report-data")
async def get_call_report_data(call_id: str):
    report = call_reports.get(call_id)
    if report is None:
        raise HTTPException(
            404,
            detail=f"Report not found for call_id={call_id}. "
                   "It may have expired or the call hasn't been processed yet."
        )
    return report


@app.get("/api/calls/debug/list")
async def list_stored_reports():
    return {
        "stored_count": len(call_reports),
        "call_ids": list(call_reports.keys()),
    }

@app.post("/api/call-summary/group")
async def call_summary_group(
    authorization: str | None = Header(default=None),
    local_audio: UploadFile | None = File(default=None),
    remote_audio: UploadFile | None = File(default=None),
    group_name: str = "",
    member_names: str = "",
    member_emails: str = "[]",
    call_start: str = "",
    call_end: str = "",
    call_events: str = "",
    target_email: str = "",
    caller_email: str = "",
    receiver_email: str = "",
):
    """Summarise a group video call.

    ``member_emails`` should be a JSON‑encoded list of email addresses.
    ``member_names`` is a comma‑separated list of display names.
    The payload is extended with ``group_name`` and the members' details before
    being sent to the existing n8n workflow.
    """
    # Re‑use the existing 1‑on‑1 logic with additional group data
    user = await authenticated_user(authorization)

    # Transcribe both sides concurrently
    local_text, remote_text = await asyncio.gather(
        _transcribe_upload(local_audio),
        _transcribe_upload(remote_audio),
    )

    my_display = user.username
    my_mail = caller_email or user.email or ""
    email_destination = target_email or receiver_email or my_mail

    # Build basic transcript
    transcript_lines = []
    if local_text:
        transcript_lines.append(f"{my_display}: {local_text}")
    if remote_text:
        transcript_lines.append(f"Group: {remote_text}")
    full_transcript = "\n".join(transcript_lines) or "(No speech detected)"

    # Duration handling (same as 1‑on‑1)
    duration_str = "Not available"
    try:
        from datetime import datetime as _dt
        fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
        t_start = _dt.strptime(call_start.replace("Z", "Z"), fmt) if call_start else None
        t_end = _dt.strptime(call_end.replace("Z", "Z"), fmt) if call_end else None
        if t_start and t_end:
            delta = t_end - t_start
            mins, secs = divmod(int(delta.total_seconds()), 60)
            duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"
    except Exception:
        pass

    # Participants – caller + members
    participants = [{"name": my_display, "email": my_mail, "role": "caller"}]
    try:
        emails = json.loads(member_emails or "[]")
    except Exception:
        emails = []
    names = [n.strip() for n in (member_names or "").split(",") if n.strip()]
    for idx, email in enumerate(emails):
        name = names[idx] if idx < len(names) else email
        participants.append({"name": name, "email": email, "role": "member"})

    # Important events – reuse minimal synthesis if missing
    important_events = []
    try:
        if call_events:
            important_events = json.loads(call_events)
    except Exception:
        pass
    if not important_events:
        if call_start:
            important_events.append({"time": call_start, "event": "Call started", "participant": my_display})
        if call_end:
            important_events.append({"time": call_end, "event": "Call ended", "participant": my_display})

    payload = {
        "call_id": str(uuid.uuid4()),
        "caller": my_display,
        "caller_email": my_mail,
        "receiver": "",
        "receiver_email": "",
        "email": email_destination,
        "to_email": email_destination,
        "participants": participants,
        "call_start": call_start or "Not available",
        "call_end": call_end or "Not available",
        "call_duration": duration_str,
        "local_transcript": local_text or "(no speech)",
        "remote_transcript": remote_text or "(no speech)",
        "full_transcript": full_transcript,
        "important_events": important_events,
        "group_name": group_name,
        "member_names": member_names,
        "member_emails": member_emails,
        "decisions": [],
        "action_items": [],
        "technical_issues": [],
    }

    # Store report for later retrieval
    if len(call_reports) >= MAX_CALL_REPORTS:
        oldest_key = next(iter(call_reports))
        del call_reports[oldest_key]
    call_reports[payload["call_id"]] = payload

    print(f"[call-summary] Stored group report id={payload['call_id']} group={group_name}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            n8n_resp = await client.post(N8N_WEBHOOK_URL, json=payload)
        n8n_resp.raise_for_status()
        print(f"[call-summary] n8n responded: {n8n_resp.status_code}")
    except httpx.HTTPStatusError as e:
        print(f"[call-summary] n8n HTTP error: {e.response.status_code} {e.response.text}")
        raise HTTPException(502, f"n8n returned {e.response.status_code}")
    except Exception as e:
        print(f"[call-summary] n8n request failed: {e}")
        raise HTTPException(502, "Could not reach n8n webhook")

    return {
        "ok": True,
        "call_id": payload["call_id"],
        "group_name": group_name,
        "duration": duration_str,
        "transcript": full_transcript,
        "n8n_status": n8n_resp.status_code,
    }

