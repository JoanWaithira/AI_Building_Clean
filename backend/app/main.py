import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database import SessionLocal, get_db
from app.routes.forecasts_new import router as forecasts_router
from app.routes.forecasts_csv import router as forecasts_csv_router
from app.routes.meters import router as meters_router
from app.routes.accuracy import router as accuracy_router
from app.routes.gate_proxy import router as gate_proxy_router

app = FastAPI(title="Forecast API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_db() -> tuple[bool, str | None]:
    """Run DB connectivity check in a thread. Returns (ok, error_message)."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as exc:
        return False, str(exc)
    finally:
        db.close()


@app.on_event("startup")
async def startup_db_check() -> None:
    loop = asyncio.get_event_loop()
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            ok, err = await asyncio.wait_for(
                loop.run_in_executor(pool, _check_db),
                timeout=8.0,
            )
        app.state.db_startup_ok = ok
        app.state.db_startup_error = err
    except asyncio.TimeoutError:
        logger.warning("DB startup check timed out — continuing without DB")
        app.state.db_startup_ok = False
        app.state.db_startup_error = "startup check timed out"


@app.get("/")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "forecast-api"}


@app.get("/health/db")
def db_health(db: Session = Depends(get_db)) -> dict[str, str | bool | None]:
    startup_ok = bool(getattr(app.state, "db_startup_ok", False))
    startup_error = getattr(app.state, "db_startup_error", None)

    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "database": "reachable",
            "startup_check_ok": startup_ok,
            "startup_error": startup_error,
        }
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "error",
                "database": "unreachable",
                "startup_check_ok": startup_ok,
                "startup_error": startup_error,
                "error": str(exc),
            },
        ) from exc


from api.pg_forecast_provider import router as pg_forecast_router

app.include_router(meters_router)
app.include_router(forecasts_router)
app.include_router(forecasts_csv_router)
app.include_router(accuracy_router)
app.include_router(pg_forecast_router)
app.include_router(gate_proxy_router)
