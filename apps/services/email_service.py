import asyncio
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
import os
from pathlib import Path
import smtplib
from dotenv import load_dotenv

TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "templates" / "emails" / "otp_email.html"


def _load_template() -> str:
    if TEMPLATE_PATH.exists():
        return TEMPLATE_PATH.read_text(encoding="utf-8")
    return """
    <html>
      <body style="font-family: sans-serif; background: #1b1f26; color: #fff; padding: 20px;">
        <h2>Relay Verification Code</h2>
        <p>Your OTP code is: <strong style="font-size: 24px; color: #8fd4d0;">{{ otp }}</strong></p>
        <p>This code expires in 5 minutes.</p>
      </body>
    </html>
    """


def _send_sync(to_email: str, otp: str) -> bool:
    load_dotenv(override=True)

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip() or to_email
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "Relay")
    smtp_from_email = os.getenv("SMTP_FROM_EMAIL", "").strip() or smtp_user or "no-reply@relay.internal"

    print("\n" + "=" * 60)
    print(f"[*] OTP CODE GENERATED FOR {to_email}: {otp}")
    print("=" * 60 + "\n")

    if not smtp_password:
        print("[EMAIL SERVICE] No SMTP_PASSWORD set. Live email dispatch skipped.")
        return False

    template = _load_template()
    html_content = template.replace("{{ otp }}", otp).replace("{{ recipient_email }}", to_email)
    text_content = (
        f"Your Relay Verification Code is: {otp}\n\n"
        f"This single-use code is valid for 5 minutes.\n"
        f"If you did not request this, you can safely ignore this email."
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{otp} is your Relay verification code"
    msg["From"] = formataddr((str(Header(smtp_from_name, "utf-8")), smtp_from_email))
    msg["To"] = to_email

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)
            print(f"[EMAIL SERVICE] Successfully sent live OTP email to {to_email}")
            return True
    except Exception as e:
        print(f"[EMAIL SERVICE ERROR] Failed to send email via SMTP to {to_email}: {e}")
        raise RuntimeError(f"Email delivery failed: {e}") from e


async def send_otp_email(to_email: str, otp: str) -> bool:
    """Asynchronously send the OTP email without blocking the FastAPI event loop."""
    return await asyncio.to_thread(_send_sync, to_email, otp)

