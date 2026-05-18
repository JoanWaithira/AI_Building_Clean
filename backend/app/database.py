import os
from collections.abc import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:password@host:5432/gate_forecasts",
)

engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,
    future=True,
    connect_args={"connect_timeout": 5},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_supabase_provider():
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        return None
    from app.providers.supabase_rest_forecast_provider import SupabaseRestForecastProvider
    return SupabaseRestForecastProvider(SUPABASE_URL, SUPABASE_SECRET_KEY)
