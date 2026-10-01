from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.models.database import Base


class User(Base):
	__tablename__ = "users"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
	email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=True)
	password_hash: Mapped[str] = mapped_column(String(255))
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	sent_messages: Mapped[list["Message"]] = relationship(
		foreign_keys="Message.sender_id", back_populates="sender"
	)
	received_messages: Mapped[list["Message"]] = relationship(
		foreign_keys="Message.receiver_id", back_populates="receiver"
	)


class Message(Base):
	__tablename__ = "messages"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	content: Mapped[str] = mapped_column(Text)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	sender: Mapped[User] = relationship(
		foreign_keys=[sender_id], back_populates="sent_messages"
	)
	receiver: Mapped[User] = relationship(
		foreign_keys=[receiver_id], back_populates="received_messages"
	)


class Group(Base):
	__tablename__ = "groups"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	name: Mapped[str] = mapped_column(String(100))
	created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	creator: Mapped[User] = relationship(foreign_keys=[created_by])
	members: Mapped[list["GroupMember"]] = relationship(
		back_populates="group", cascade="all, delete-orphan"
	)
	messages: Mapped[list["GroupMessage"]] = relationship(
		back_populates="group", cascade="all, delete-orphan"
	)


class GroupMember(Base):
	__tablename__ = "group_members"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
	user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	joined_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	group: Mapped[Group] = relationship(back_populates="members")
	user: Mapped[User] = relationship(foreign_keys=[user_id])


class GroupMessage(Base):
	__tablename__ = "group_messages"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
	sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	content: Mapped[str] = mapped_column(Text)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	group: Mapped[Group] = relationship(back_populates="messages")
	sender: Mapped[User] = relationship(foreign_keys=[sender_id])


class UserE2EE(Base):
	"""
	Stores the X3DH public key bundle for a user.

	- public_key        : Identity key (IK) — long-lived ECDH/Ed25519 public key (JWK JSON).
	- signed_prekey     : Current signed prekey (SPK) public key (JWK JSON).
	- signed_prekey_id  : Monotonic integer ID for the SPK (allows rotation tracking).
	- spk_signature     : Ed25519 signature of the SPK by the identity key (base64).

	One-time prekeys (OPKs) are stored in a separate table (OneTimePreKey).
	Private keys are NEVER stored server-side; they live in the client's IndexedDB.
	"""
	__tablename__ = "user_e2ee"

	user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
	# Identity key (IK) — previously "public_key", kept for backwards compat alias
	public_key: Mapped[str] = mapped_column(Text)
	# Signed PreKey bundle
	signed_prekey: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
	signed_prekey_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
	spk_signature: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	updated_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
	)
	one_time_prekeys: Mapped[list["OneTimePreKey"]] = relationship(
		"OneTimePreKey",
		primaryjoin="UserE2EE.user_id == OneTimePreKey.user_id",
		foreign_keys="[OneTimePreKey.user_id]",
		back_populates="owner",
		cascade="all, delete-orphan",
	)


class OneTimePreKey(Base):
	"""
	One-time prekeys (OPKs) for X3DH.
	Each key can only be claimed once (used=True after a successful X3DH handshake).
	The client uploads a batch; the server hands one out per new session and marks it used.
	"""
	__tablename__ = "one_time_prekeys"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	key_id: Mapped[int] = mapped_column(Integer, nullable=False)
	public_key: Mapped[str] = mapped_column(Text, nullable=False)   # JWK JSON
	used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)
	owner: Mapped[UserE2EE] = relationship(
		"UserE2EE",
		primaryjoin="OneTimePreKey.user_id == UserE2EE.user_id",
		foreign_keys="[OneTimePreKey.user_id]",
		back_populates="one_time_prekeys",
	)


class GroupE2EEKey(Base):
	__tablename__ = "group_e2ee_keys"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
	user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	encrypted_key: Mapped[str] = mapped_column(Text)
	created_at: Mapped[datetime] = mapped_column(
		DateTime(timezone=True), server_default=func.now()
	)

