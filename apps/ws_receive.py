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
from sqlalchemy import select
from apps.models.schemas import Credentials, MessageCreate

from apps.models.database import SessionLocal, lifespan
from apps.models.model import Message, User
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

app = FastAPI(lifespan=lifespan)
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "")
manager = ConnectionManager()
voice_sessions = {}
# In-memory store for call report data keyed by call_id.
# n8n's HTTP Request node fetches from GET /api/calls/{call_id}/report-data.
# Capped at 200 entries; oldest entry evicted when full.
call_reports: dict = {}
MAX_CALL_REPORTS = 200
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "templates", "static")), name="static")
JWT_SECRET = os.getenv("JWT_SECRET", "development-only-change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60
CALL_SIGNAL_TYPES = {
    "call_offer",
    "call_answer",
    "call_ice",
    "call_reject",
    "call_end",
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


async def relay_call_signal(payload: dict, sender_id: int, default_target_id: int | None) -> bool:
    signal_type = payload.get("type")
    if signal_type not in CALL_SIGNAL_TYPES:
        return False

    print("payload------------------------------------->", payload)
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
            print("payload in signaling-endpoint------------------------------------------", payload)
            await relay_call_signal(payload, user_pk, payload.get("target_id"))
    except WebSocketDisconnect:
        manager.disconnect(user_pk, websocket)


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
    call_events: str = "",   # optional JSON array of browser-side events
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
        {"name": my_display,   "role": "caller"},
        {"name": peer_display, "role": "receiver"},
    ]

    # Important events — from browser-sent JSON array or sensible defaults
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
        "receiver":        peer_display,
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


DUMMY_CONVERSATION = """Rahul: Hi Priya, thanks for joining. I wanted to discuss the current status of the website and what we need to finish before the launch.
Priya: Sure. The frontend is mostly complete. The login page, dashboard, and user profile are finished. I'm currently working on the notification feature.
Rahul: How much work is left on the notification feature?
Priya: The UI is almost finished, but I still need the notification API from the backend.
Rahul: I spoke with Amit earlier. He said the API should be ready by Thursday.
Priya: Okay. Once I get the API, I should need about two days to integrate it and test the feature.
Rahul: So integration testing should be finished by Friday?
Priya: Yes, assuming the API is delivered on Thursday.
Rahul: Good. What about the database migration?
Priya: I don't have any issues on the frontend side. Is the migration already tested?
Rahul: Not completely. The migration scripts are ready, but they still need to be tested on the staging database.
Priya: That should be done before we start the final testing.
Rahul: Agreed. There's also an issue with the SMTP configuration in staging. Emails aren't being delivered correctly.
Priya: Is that blocking the notification development?
Rahul: No, development can continue, but we need to fix it before production deployment.
Priya: Okay. When are we planning to launch?
Rahul: The current target is Monday, September 28.
Priya: That's quite soon. Are we deploying to AWS?
Rahul: Yes. Production will be hosted on AWS. We're keeping the current server for staging.
Priya: Do we have the production domain ready?
Rahul: Not yet. The client still needs to confirm the final branding and domain name.
Priya: Understood. I'll continue with the frontend work while we wait for the API.
Rahul: I'll follow up with the infrastructure team today about the SMTP issue and make sure the database migration testing is completed.
Priya: I'll finish the notification UI today and start integration as soon as the API is available.
Rahul: Perfect. Let's target Friday for the complete integration test.
Priya: Sounds good. If we find any major issues during testing, we'll discuss them before the launch.
Rahul: Exactly. I'll schedule a short review meeting for Friday afternoon.
Priya: Great. Thanks, Rahul.
Rahul: Thanks, Priya. Talk to you Friday."""


@app.post("/api/calls/test-dummy")
async def trigger_dummy_call_summary():
    """
    Simulates a completed call with dummy transcript between Rahul and Priya,
    stores report in memory for n8n retrieval, and forwards payload to n8n webhook.
    """
    call_id = str(uuid.uuid4())
    rahul_lines = "\n".join(
        [line.split("Rahul: ", 1)[1] for line in DUMMY_CONVERSATION.splitlines() if line.startswith("Rahul: ")]
    )
    priya_lines = "\n".join(
        [line.split("Priya: ", 1)[1] for line in DUMMY_CONVERSATION.splitlines() if line.startswith("Priya: ")]
    )

    payload = {
        "call_id": call_id,
        "caller": "Rahul",
        "receiver": "Priya",
        "participants": [
            {"name": "Rahul", "role": "caller"},
            {"name": "Priya", "role": "receiver"},
        ],
        "call_start": "2026-09-22T10:00:00.000Z",
        "call_end": "2026-09-22T10:08:45.000Z",
        "call_duration": "8m 45s",
        "local_transcript": rahul_lines,
        "remote_transcript": priya_lines,
        "full_transcript": DUMMY_CONVERSATION,
        "important_events": [
            {"time": "2026-09-22T10:00:00.000Z", "event": "Call started", "participant": "Rahul"},
            {"time": "2026-09-22T10:00:05.000Z", "event": "Participant joined", "participant": "Priya"},
            {"time": "2026-09-22T10:08:45.000Z", "event": "Call ended", "participant": "Rahul"},
        ],
        "decisions": [],
        "action_items": [],
        "technical_issues": [],
    }

    if len(call_reports) >= MAX_CALL_REPORTS:
        oldest_key = next(iter(call_reports))
        del call_reports[oldest_key]
    call_reports[call_id] = payload

    n8n_status = None
    n8n_body = ""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            n8n_resp = await client.post(N8N_WEBHOOK_URL, json=payload)
        n8n_status = n8n_resp.status_code
        n8n_body = n8n_resp.text
    except Exception as e:
        n8n_body = str(e)

    return {
        "ok": True,
        "call_id": call_id,
        "n8n_status": n8n_status,
        "n8n_response": n8n_body,
        "report_data_url": f"/api/calls/{call_id}/report-data",
        "summary_webhook_url": N8N_WEBHOOK_URL,
    }