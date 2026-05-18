from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

from app.config import SUPABASE_DATABASE_URL

logger = logging.getLogger(__name__)

_CIRCUIT_FORECAST_COLUMNS = [
    "circuit_id",
    "forecast_timestamp",
    "forecast_value",
    "step_ahead",
    "generated_at",
    "model_type",
    "model_version",
    "resolution",
]

# forecast_long_term has two extra nullable confidence bound columns
_LONG_TERM_FORECAST_COLUMNS = _CIRCUIT_FORECAST_COLUMNS + [
    "confidence_lower",
    "confidence_upper",
]

_GLOBAL_FORECAST_COLUMNS = [
    "forecast_timestamp",
    "global_prediction",
    "step_ahead",
    "generated_at",
    "model_version",
    "resolution",
]

TABLE_CONFIG: dict[str, dict[str, Any]] = {
    "forecast_short_term": {
        "columns": _CIRCUIT_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS forecast_short_term (
                id BIGSERIAL PRIMARY KEY,
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER NOT NULL,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT NOT NULL,
                model_version TEXT NOT NULL,
                resolution TEXT NOT NULL
            )
            """,
            """
            ALTER TABLE forecast_short_term
                ADD COLUMN IF NOT EXISTS id BIGSERIAL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_short_term_circuit_ts_resolution
            ON forecast_short_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
    "forecast_long_term": {
        "columns": _LONG_TERM_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS forecast_long_term (
                id BIGSERIAL PRIMARY KEY,
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER NOT NULL,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT NOT NULL,
                model_version TEXT NOT NULL,
                resolution TEXT NOT NULL,
                confidence_lower DOUBLE PRECISION,
                confidence_upper DOUBLE PRECISION
            )
            """,
            """
            ALTER TABLE forecast_long_term
                ADD COLUMN IF NOT EXISTS id BIGSERIAL,
                ADD COLUMN IF NOT EXISTS confidence_lower DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS confidence_upper DOUBLE PRECISION
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_long_term_circuit_ts_resolution
            ON forecast_long_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
    "forecast_global": {
        "columns": _GLOBAL_FORECAST_COLUMNS,
        "conflict_columns": ["forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS forecast_global (
                id BIGSERIAL PRIMARY KEY,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                global_prediction DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER NOT NULL,
                generated_at TIMESTAMPTZ NOT NULL,
                model_version TEXT NOT NULL,
                resolution TEXT NOT NULL
            )
            """,
            """
            ALTER TABLE forecast_global
                ADD COLUMN IF NOT EXISTS id BIGSERIAL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_global_ts_resolution
            ON forecast_global (forecast_timestamp, resolution)
            """,
        ],
    },
    "unified_local_short_term": {
        "columns": _CIRCUIT_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS unified_local_short_term (
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT,
                model_version TEXT,
                resolution TEXT NOT NULL
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_unified_local_short_term_circuit_ts_resolution
            ON unified_local_short_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
    "unified_local_long_term": {
        "columns": _CIRCUIT_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS unified_local_long_term (
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT,
                model_version TEXT,
                resolution TEXT NOT NULL
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_unified_local_long_term_circuit_ts_resolution
            ON unified_local_long_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
    "unified_global_short_term": {
        "columns": _CIRCUIT_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS unified_global_short_term (
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT,
                model_version TEXT,
                resolution TEXT NOT NULL
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_unified_global_short_term_circuit_ts_resolution
            ON unified_global_short_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
    "unified_global_long_term": {
        "columns": _CIRCUIT_FORECAST_COLUMNS,
        "conflict_columns": ["circuit_id", "forecast_timestamp", "resolution"],
        "timestamp_columns": ["forecast_timestamp", "generated_at"],
        "ddl": [
            """
            CREATE TABLE IF NOT EXISTS unified_global_long_term (
                circuit_id TEXT NOT NULL,
                forecast_timestamp TIMESTAMPTZ NOT NULL,
                forecast_value DOUBLE PRECISION NOT NULL,
                step_ahead INTEGER,
                generated_at TIMESTAMPTZ NOT NULL,
                model_type TEXT,
                model_version TEXT,
                resolution TEXT NOT NULL
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_unified_global_long_term_circuit_ts_resolution
            ON unified_global_long_term (circuit_id, forecast_timestamp, resolution)
            """,
        ],
    },
}


@lru_cache(maxsize=1)
def _get_supabase_engine() -> Engine | None:
    if not SUPABASE_DATABASE_URL:
        return None

    engine_kwargs: dict[str, Any] = {"pool_pre_ping": True}
    if SUPABASE_DATABASE_URL.startswith("postgresql"):
        engine_kwargs["connect_args"] = {"connect_timeout": 5, "sslmode": "require"}

    return create_engine(SUPABASE_DATABASE_URL, **engine_kwargs)


def _prepare_records(
    dataframe: pd.DataFrame,
    ordered_columns: list[str],
    timestamp_columns: list[str],
) -> list[dict[str, Any]]:
    if dataframe.empty:
        return []

    db_frame = dataframe.copy()

    for column in ordered_columns:
        if column not in db_frame.columns:
            db_frame[column] = None

    db_frame = db_frame[ordered_columns]

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


def _build_upsert_statement(table_name: str) -> Any:
    config = TABLE_CONFIG[table_name]
    columns = config["columns"]
    conflict_columns = config["conflict_columns"]
    update_columns = [column for column in columns if column not in conflict_columns]

    insert_columns = ",\n            ".join(columns)
    insert_values = ",\n            ".join(f":{column}" for column in columns)
    conflict_target = ", ".join(conflict_columns)
    update_assignments = ",\n            ".join(
        f"{column} = EXCLUDED.{column}" for column in update_columns
    )

    return text(f"""
        INSERT INTO {table_name} (
            {insert_columns}
        )
        VALUES (
            {insert_values}
        )
        ON CONFLICT ({conflict_target}) DO UPDATE
        SET
            {update_assignments}
        """)


def _format_supabase_error(exc: Exception) -> str:
    message = str(exc)
    if "could not translate host name" in message and "supabase" in message.lower():
        return (
            f"{exc} | Hint: the configured Supabase hostname could not be resolved. "
            "Use the Supabase Session Pooler connection string for IPv4-friendly access."
        )
    return message


def mirror_table_to_supabase(table_name: str, forecast_df: pd.DataFrame) -> bool:
    engine = _get_supabase_engine()
    if engine is None:
        return False

    config = TABLE_CONFIG.get(table_name)
    if config is None:
        raise ValueError(f"Unsupported Supabase forecast table: {table_name}")

    records = _prepare_records(
        forecast_df,
        ordered_columns=config["columns"],
        timestamp_columns=config["timestamp_columns"],
    )
    if not records:
        return False

    try:
        with engine.begin() as connection:
            for ddl_statement in config["ddl"]:
                connection.execute(text(ddl_statement))

            connection.execute(_build_upsert_statement(table_name), records)

        logger.info("Supabase mirror OK for %s (%d rows)", table_name, len(records))
        print(f"  [Supabase] mirror OK for {table_name}: {len(records)} rows")
        return True
    except OperationalError as exc:
        logger.exception("Supabase write failed for %s", table_name)
        print(
            f"  [Supabase] write FAILED for {table_name}: {_format_supabase_error(exc)}"
        )
        return False
    except Exception as exc:
        logger.exception("Supabase write failed for %s", table_name)
        print(f"  [Supabase] write FAILED for {table_name}: {exc}")
        return False


def mirror_table_to_supabase_isolated(
    table_name: str,
    forecast_df: pd.DataFrame,
    *,
    timeout_seconds: int = 120,
) -> bool:
    """Run Supabase mirroring in a child process to protect the scheduler."""
    if not SUPABASE_DATABASE_URL or forecast_df.empty:
        return False

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".csv",
            prefix=f"{table_name}_",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            forecast_df.to_csv(temp_file, index=False)

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "app.utils.supabase_writers",
                table_name,
                str(temp_path),
            ],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"  [Supabase] isolated mirror timed out for {table_name}")
        return False
    except Exception as exc:
        print(f"  [Supabase] isolated mirror failed for {table_name}: {exc}")
        return False
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode == 0:
        return True

    if result.stderr:
        print(result.stderr.rstrip())
    print(
        f"  [Supabase] isolated mirror failed for {table_name}: "
        f"exit code {result.returncode}"
    )
    return False


def _run_cli() -> int:
    if len(sys.argv) != 3:
        print("Usage: python -m app.utils.supabase_writers <table_name> <csv_path>")
        return 2

    table_name = sys.argv[1]
    csv_path = sys.argv[2]
    forecast_df = pd.read_csv(csv_path)
    return 0 if mirror_table_to_supabase(table_name, forecast_df) else 1


if __name__ == "__main__":
    raise SystemExit(_run_cli())
