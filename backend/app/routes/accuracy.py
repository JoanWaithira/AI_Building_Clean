import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, literal, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ForecastGlobal, ForecastLongTerm, ForecastShortTerm
from app.normalization.forecast_normalizer import ForecastNormalizer
from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forecasts/accuracy", tags=["accuracy"])

_TABLE_MAP = {
    ("local", "short_term"): ForecastShortTerm,
    ("local", "long_term"): ForecastLongTerm,
    ("global", "short_term"): ForecastGlobal,
    ("global", "long_term"): ForecastGlobal,
}


@router.get("/", response_model=list[ForecastRecord])
async def get_accuracy_records(
    scope: Literal["local", "global"] = Query(description="Forecast scope: local or global"),
    product: Literal["short_term", "long_term"] = Query(description="Forecast product"),
    circuit_id: str | None = Query(None, description="Circuit ID (required when scope=local)"),
    hours_back: int = Query(default=24, ge=1, le=168, description="How many hours back to retrieve past forecasts"),
    db: Session = Depends(get_db),
) -> list[ForecastRecord]:
    table = _TABLE_MAP.get((scope, product))
    if table is None:
        logger.warning("No table for scope=%s product=%s", scope, product)
        return []

    if scope == "local" and not circuit_id:
        logger.warning("circuit_id required for local scope accuracy query")
        return []

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours_back)

    filters = [
        table.forecast_timestamp <= now,
        table.forecast_timestamp >= cutoff,
    ]
    if scope == "local":
        filters.append(table.circuit_id == circuit_id)

    if scope == "global":
        stmt = (
            select(
                literal("global").label("circuit_id"),
                table.forecast_timestamp.label("forecast_timestamp"),
                table.global_prediction.label("forecast_value"),
                table.step_ahead.label("step_ahead"),
                table.generated_at.label("generated_at"),
                literal("global").label("model_type"),
                table.model_version.label("model_version"),
                table.resolution.label("resolution"),
            )
            .where(and_(*filters))
            .order_by(table.forecast_timestamp.asc())
        )
    else:
        stmt = (
            select(
                table.circuit_id,
                table.forecast_timestamp,
                table.forecast_value,
                table.step_ahead,
                table.generated_at,
                table.model_type,
                table.model_version,
                table.resolution,
            )
            .where(and_(*filters))
            .order_by(table.forecast_timestamp.asc())
        )

    try:
        rows = db.execute(stmt).all()
    except Exception as exc:
        logger.warning("Accuracy query failed (database unavailable), returning empty: %s", exc)
        return []

    if not rows:
        logger.debug(
            "No past forecast rows for scope=%s product=%s circuit=%s hours_back=%d",
            scope, product, circuit_id, hours_back,
        )
        return []

    records = ForecastNormalizer.deduplicate_and_sort(
        ForecastNormalizer.normalize_records(rows, scope, product)
    )
    logger.info(
        "Accuracy: returned %d records (scope=%s product=%s circuit=%s)",
        len(records), scope, product, circuit_id,
    )
    return records
