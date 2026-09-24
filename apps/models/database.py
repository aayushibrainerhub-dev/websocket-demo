import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
# from apps.models import model

load_dotenv()


class Base(DeclarativeBase):
	pass


DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL.startswith("postgresql+psycopg://"):
	DATABASE_URL = DATABASE_URL.replace("postgresql+psycopg://", "postgresql+asyncpg://", 1)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


from sqlalchemy import text

async def init_db():

	async with engine.begin() as connection:
		await connection.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def lifespan(app):
	await init_db()
	yield
