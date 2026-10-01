from typing import Optional
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


# ---------------------------------------------------------------------------
# Legacy AES-GCM schemas (kept for backwards compatibility)
# ---------------------------------------------------------------------------

class SetPublicKeyRequest(BaseModel):
    public_key: str


class SetGroupKeysRequest(BaseModel):
    keys: dict[int, str]


# ---------------------------------------------------------------------------
# Double Ratchet / X3DH schemas (v2 E2EE)
# ---------------------------------------------------------------------------

class OneTimePreKeyItem(BaseModel):
    """A single one-time prekey to be uploaded."""
    key_id: int
    public_key: str  # JWK JSON string


class UploadPreKeyBundleRequest(BaseModel):
    """
    Full X3DH key bundle uploaded by a client after registration or key rotation.

    Fields:
    - identity_key      : Long-lived identity public key (IK), JWK JSON.
    - signed_prekey     : Signed prekey (SPK) public key, JWK JSON.
    - signed_prekey_id  : Monotonic integer identifying this SPK rotation.
    - spk_signature     : Base64-encoded Ed25519 (or ECDSA) signature of the
                          SPK by the identity key. Clients verify this before
                          using the bundle to detect server tampering.
    - one_time_prekeys  : Batch of fresh OPKs (typically 10–100). Optional on
                          subsequent uploads (can upload OPKs separately).
    """
    identity_key: str
    signed_prekey: str
    signed_prekey_id: int
    spk_signature: str
    one_time_prekeys: Optional[list[OneTimePreKeyItem]] = None


class UploadOneTimePreKeysRequest(BaseModel):
    """Upload additional OPKs without touching the SPK/IK."""
    one_time_prekeys: list[OneTimePreKeyItem]


class PreKeyBundleResponse(BaseModel):
    """
    Bundle returned when Alice wants to start a session with Bob.

    The server hands out at most one OPK per bundle request and marks it used.
    If no OPKs remain the field is None (X3DH still works; forward secrecy is
    slightly reduced for that session).
    """
    user_id: int
    identity_key: str           # IK public key, JWK JSON
    signed_prekey: str          # SPK public key, JWK JSON
    signed_prekey_id: int
    spk_signature: str          # Signature for client-side verification
    one_time_prekey: Optional[OneTimePreKeyItem] = None   # Claimed OPK (or None)
    opk_count: int = 0          # Remaining OPK count so client can top up


class OPKCountResponse(BaseModel):
    """How many unused OPKs remain for the authenticated user."""
    user_id: int
    opk_count: int
