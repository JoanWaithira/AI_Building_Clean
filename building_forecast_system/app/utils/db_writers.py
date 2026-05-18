from __future__ import annotations

import logging
from typing import Any

import pandas as pd
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.db import engine
from app.utils.supabase_writers import (
    mirror_table_to_supabase,
    mirror_table_to_supabase_isolated,
)

logger = logging.getLogger(__name__)


def _local_db_write(insert_stmt, records: list[dict]) -> bool:
    """Execute an insert against the local DB. Returns True on success."""
    try:
        with engine.begin() as connection:
            connection.execute(insert_stmt, records)
        return True
    except (OperationalError, SQLAlchemyError) as exc:
        logger.warning("Local DB write skipped (unreachable): %s", exc)
        return False


def _assert_table_exists(table_name: str) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(table_name):
        raise RuntimeError(
            f"Required database table '{table_name}' does not exist for DATABASE_URL. "
            "Apply the schema in sql/create_tables.sql before running inference."
        )


def _prepare_records(
    forecast_df: pd.DataFrame, timestamp_columns: list[str]
) -> list[dict[str, Any]]:
    if forecast_df.empty:
        return []

    db_frame = forecast_df.copy()

    for column in timestamp_columns:
        if column in db_frame.columns:
            db_frame[column] = pd.to_datetime(
                db_frame[column], utc=True, errors="coerce"
            )

    db_frame = db_frame.where(pd.notna(db_frame), None)
    records = db_frame.to_dict(orient="records")

    for record in records:
        for column in timestamp_columns:
            value = record.get(column)
            if value is not None and hasattr(value, "to_pydatetime"):
                record[column] = value.to_pydatetime()

    return records


def write_short_forecast_to_db(forecast_df: pd.DataFrame) -> None:
    records = _prepare_records(
        forecast_df,
        timestamp_columns=["forecast_timestamp", "generated_at"],
    )
    if not records:
        return

    try:
        _assert_table_exists("forecast_short_term")
        insert_stmt = text("""
            INSERT INTO forecast_short_term (
                circuit_id,
                forecast_timestamp,
                forecast_value,
                step_ahead,
                generated_at,
                model_type,
                model_version,
                resolution
            )
            VALUES (
                :circuit_id,
                :forecast_timestamp,
                :forecast_value,
                :step_ahead,
                :generated_at,
                :model_type,
                :model_version,
                :resolution
            )
            """)
        _local_db_write(insert_stmt, records)
    except (OperationalError, SQLAlchemyError, RuntimeError) as exc:
        logger.warning("Local DB unavailable for forecast_short_term: %s", exc)

    mirror_table_to_supabase_isolated("forecast_short_term", forecast_df)


def write_long_forecast_to_db(forecast_df: pd.DataFrame) -> None:
    records = _prepare_records(
        forecast_df,
        timestamp_columns=["forecast_timestamp", "generated_at"],
    )
    if not records:
        return

    try:
        _assert_table_exists("forecast_long_term")
        insert_stmt = text("""
            INSERT INTO forecast_long_term (
                circuit_id,
                forecast_timestamp,
                forecast_value,
                step_ahead,
                generated_at,
                model_type,
                model_version,
                resolution
            )
            VALUES (
                :circuit_id,
                :forecast_timestamp,
                :forecast_value,
                :step_ahead,
                :generated_at,
                :model_type,
                :model_version,
                :resolution
            )
            """)
        _local_db_write(insert_stmt, records)
    except (OperationalError, SQLAlchemyError, RuntimeError) as exc:
        logger.warning("Local DB unavailable for forecast_long_term: %s", exc)

    mirror_table_to_supabase("forecast_long_term", forecast_df)


def write_global_forecast_to_db(forecast_df: pd.DataFrame) -> None:
    records = _prepare_records(
        forecast_df,
        timestamp_columns=["forecast_timestamp", "generated_at"],
    )
    if not records:
        return

    try:
        _assert_table_exists("forecast_global")
        insert_stmt = text("""
            INSERT INTO forecast_global (
                forecast_timestamp,
                global_prediction,
                step_ahead,
                generated_at,
                model_version,
                resolution
            )
            VALUES (
                :forecast_timestamp,
                :global_prediction,
                :step_ahead,
                :generated_at,
                :model_version,
                :resolution
            )
            """)
        _local_db_write(insert_stmt, records)
    except (OperationalError, SQLAlchemyError, RuntimeError) as exc:
        logger.warning("Local DB unavailable for forecast_global: %s", exc)

    mirror_table_to_supabase("forecast_global", forecast_df)
