import os
import socket
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

load_dotenv()


class Base(DeclarativeBase):
	pass

DATABASE_URL = os.getenv("DATABASE_URL")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
	"""Initialize database tables"""
	try:
		async with engine.begin() as connection:
			await connection.run_sync(Base.metadata.create_all)
		print("[✓] Database tables initialized successfully")
	except Exception as e:
		print(f"[ERROR] Failed to initialize database: {e}")
		raise


@asynccontextmanager
async def lifespan(app):
	"""FastAPI lifespan: startup and shutdown"""
	try:
		print("[•] Initializing database...")
		await init_db()
		print("[✓] Database initialized")
	except Exception as e:
		print(f"[ERROR] Database initialization failed: {e}")
		raise
	
	yield
