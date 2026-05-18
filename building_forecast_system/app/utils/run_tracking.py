from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.db import engine


logger = logging.getLogger(__name__)

RUN_HISTORY_TABLE = "pipeline_run_history"

# Sentinel returned when the local DB is unreachable so callers can proceed.
_NO_DB_RUN_ID = -1


def _local_db_available() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except (OperationalError, SQLAlchemyError):
        return False


def ensure_run_history_table() -> None:
    try:
        inspector = inspect(engine)
        if inspector.has_table(RUN_HISTORY_TABLE):
            return

        create_table_stmt = text(
            """
            CREATE TABLE IF NOT EXISTS pipeline_run_history (
                id BIGSERIAL PRIMARY KEY,
                pipeline_name TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                finished_at TIMESTAMP,
                details_json TEXT,
                error_message TEXT
            )
            """
        )
        create_index_stmt = text(
            """
            CREATE INDEX IF NOT EXISTS idx_pipeline_run_history_name_started
            ON pipeline_run_history (pipeline_name, started_at DESC)
            """
        )

        with engine.begin() as connection:
            connection.execute(create_table_stmt)
            connection.execute(create_index_stmt)
    except (OperationalError, SQLAlchemyError) as exc:
        logger.warning("Local DB unavailable — run history tracking skipped: %s", exc)


def start_pipeline_run(pipeline_name: str, details: dict[str, Any] | None = None) -> int:
    try:
        ensure_run_history_table()

        insert_stmt = text(
            """
            INSERT INTO pipeline_run_history (
                pipeline_name,
                status,
                started_at,
                details_json
            )
            VALUES (
                :pipeline_name,
                :status,
                NOW(),
                :details_json
            )
            RETURNING id
            """
        )

        with engine.begin() as connection:
            run_id = connection.execute(
                insert_stmt,
                {
                    "pipeline_name": pipeline_name,
                    "status": "running",
                    "details_json": _serialize_details(details),
                },
            ).scalar_one()

        return int(run_id)
    except (OperationalError, SQLAlchemyError) as exc:
        logger.warning("Local DB unavailable — pipeline run not recorded: %s", exc)
        print(f"  [run_tracking] Local DB unreachable, continuing without run history ({exc.__class__.__name__})")
        return _NO_DB_RUN_ID


def finish_pipeline_run(
    run_id: int,
    status: str,
    details: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    if run_id == _NO_DB_RUN_ID:
        return

    try:
        ensure_run_history_table()

        update_stmt = text(
            """
            UPDATE pipeline_run_history
            SET status = :status,
                finished_at = NOW(),
                details_json = :details_json,
                error_message = :error_message
            WHERE id = :run_id
            """
        )

        with engine.begin() as connection:
            connection.execute(
                update_stmt,
                {
                    "run_id": run_id,
                    "status": status,
                    "details_json": _serialize_details(details),
                    "error_message": error_message,
                },
            )
    except (OperationalError, SQLAlchemyError) as exc:
        logger.warning("Local DB unavailable — pipeline finish not recorded: %s", exc)


def _serialize_details(details: dict[str, Any] | None) -> str | None:
    if details is None:
        return None
    return json.dumps(details, default=str, sort_keys=True)