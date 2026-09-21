from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
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
