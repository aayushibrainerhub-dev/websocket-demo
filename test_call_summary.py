"""
Standalone test script to send a dummy conversation payload directly to n8n
with dynamic email options (Receiver, Sender, or Custom).

Usage:
    python test_call_summary.py
    python test_call_summary.py --to-sender
    python test_call_summary.py --email custom@example.com
"""

import argparse
import asyncio
import os
import uuid
import httpx
from dotenv import load_dotenv

load_dotenv()

N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "https://ayushah.app.n8n.cloud/webhook/video-call-summary"
)

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


async def run_test(target_email: str | None = None, to_sender: bool = False):
    call_id = str(uuid.uuid4())
    caller = "Rahul"
    caller_email = "aayushi.brainerhub@gmail.com"  # e.g. sender email
    receiver = "Priya"
    receiver_email = "aayushi.brainerhub@gmail.com"  # e.g. receiver email

    if to_sender:
        dest_email = caller_email
        print(f"🎯 Option selected: Send to SENDER -> {dest_email}")
    elif target_email:
        dest_email = target_email
        print(f"🎯 Option selected: Send to CUSTOM -> {dest_email}")
    else:
        dest_email = receiver_email
        print(f"🎯 Option selected: Send to RECEIVER -> {dest_email}")

    rahul_lines = "\n".join(
        [line.split("Rahul: ", 1)[1] for line in DUMMY_CONVERSATION.splitlines() if line.startswith("Rahul: ")]
    )
    priya_lines = "\n".join(
        [line.split("Priya: ", 1)[1] for line in DUMMY_CONVERSATION.splitlines() if line.startswith("Priya: ")]
    )

    payload = {
        "call_id": call_id,
        "caller": caller,
        "caller_email": caller_email,
        "receiver": receiver,
        "receiver_email": receiver_email,
        "email": dest_email,
        "to_email": dest_email,
        "participants": [
            {"name": caller, "email": caller_email, "role": "caller"},
            {"name": receiver, "email": receiver_email, "role": "receiver"},
        ],
        "call_start": "2026-09-23T10:00:00.000Z",
        "call_end": "2026-09-23T10:08:45.000Z",
        "call_duration": "8m 45s",
        "local_transcript": rahul_lines,
        "remote_transcript": priya_lines,
        "full_transcript": DUMMY_CONVERSATION,
        "important_events": [
            {"time": "2026-09-23T10:00:00.000Z", "event": "Call started", "participant": caller},
            {"time": "2026-09-23T10:00:05.000Z", "event": "Participant joined", "participant": receiver},
            {"time": "2026-09-23T10:08:45.000Z", "event": "Call ended", "participant": caller},
        ],
        "decisions": [],
        "action_items": [],
        "technical_issues": [],
    }

    print(f"\n📡 Sending dummy payload to n8n webhook: {N8N_WEBHOOK_URL}")
    print(f"👥 Caller: {caller} ({caller_email})")
    print(f"👥 Receiver: {receiver} ({receiver_email})")
    print(f"📬 Summary recipient email ({{ $json.email }}): {dest_email}\n")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(N8N_WEBHOOK_URL, json=payload)
        print(f"✅ Response Status: {resp.status_code}")
        print(f"📄 Response Body: {resp.text}")
    except Exception as e:
        print(f"❌ Failed to reach n8n webhook: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test call summary n8n trigger")
    parser.add_argument("--email", type=str, help="Custom destination email address", default=None)
    parser.add_argument("--to-sender", action="store_true", help="Send to sender's email instead of receiver's")
    args = parser.parse_args()

    asyncio.run(run_test(target_email=args.email, to_sender=args.to_sender))
