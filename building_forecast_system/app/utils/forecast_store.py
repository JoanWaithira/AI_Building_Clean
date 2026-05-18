from __future__ import annotations

from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, inspect

from app.config import DATABASE_URL
from app.utils.supabase_writers import mirror_table_to_supabase_isolated

FORECASTS_DIR = Path("data/forecasts")
FORECASTS_DIR.mkdir(parents=True, exist_ok=True)

STORE_CONFIG = {
    ("local", "short"): {
        "csv_path": FORECASTS_DIR / "unified_local_short_term.csv",
        "table_name": "unified_local_short_term",
    },
    ("local", "long"): {
        "csv_path": FORECASTS_DIR / "unified_local_long_term.csv",
        "table_name": "unified_local_long_term",
    },
    ("global", "short"): {
        "csv_path": FORECASTS_DIR / "unified_global_short_term.csv",
        "table_name": "unified_global_short_term",
    },
    ("global", "long"): {
        "csv_path": FORECASTS_DIR / "unified_global_long_term.csv",
        "table_name": "unified_global_long_term",
    },
}

FORECAST_COLUMNS = [
    "circuit_id",
    "forecast_timestamp",
    "forecast_value",
    "step_ahead",
    "generated_at",
    "model_type",
    "model_version",
    "resolution",
]

DEDUP_KEYS = ["circuit_id", "forecast_timestamp", "resolution"]


def _empty_forecast_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=FORECAST_COLUMNS)


def _normalize_forecast_frame(df: pd.DataFrame) -> pd.DataFrame:
    normalized = df.copy()

    for column in FORECAST_COLUMNS:
        if column not in normalized.columns:
            if column == "generated_at":
                normalized[column] = pd.Timestamp.now("UTC")
            else:
                normalized[column] = pd.NA

    normalized = normalized[FORECAST_COLUMNS]
    normalized["forecast_timestamp"] = pd.to_datetime(
        normalized["forecast_timestamp"], utc=True, errors="coerce"
    )
    normalized["generated_at"] = pd.to_datetime(
        normalized["generated_at"], utc=True, errors="coerce"
    )
    normalized["forecast_value"] = pd.to_numeric(
        normalized["forecast_value"], errors="coerce"
    )
    normalized["step_ahead"] = pd.to_numeric(
        normalized["step_ahead"], errors="coerce"
    ).astype("Int64")

    normalized = normalized.dropna(
        subset=["circuit_id", "forecast_timestamp", "forecast_value"]
    )
    normalized = normalized.sort_values(["generated_at", "forecast_timestamp"])
    normalized = normalized.drop_duplicates(subset=DEDUP_KEYS, keep="last")

    return normalized.reset_index(drop=True)


def _read_existing_csv(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        return _empty_forecast_frame()

    existing = pd.read_csv(csv_path)
    if existing.empty:
        return _empty_forecast_frame()

    return _normalize_forecast_frame(existing)


def _write_csv_store(df: pd.DataFrame, csv_path: Path) -> None:
    existing = _read_existing_csv(csv_path)
    combined = pd.concat([existing, df], ignore_index=True)
    combined = _normalize_forecast_frame(combined)
    combined.to_csv(csv_path, index=False)


def _write_database_store(
    df: pd.DataFrame, table_name: str
) -> tuple[pd.DataFrame, bool]:
    """Write *df* into the local unified table and return (combined_df, success)."""
    if not DATABASE_URL:
        return df, False

    engine_kwargs = {}
    if DATABASE_URL.startswith("postgresql"):
        engine_kwargs["connect_args"] = {"connect_timeout": 3}

    engine = create_engine(DATABASE_URL, **engine_kwargs)

    try:
        existing = _empty_forecast_frame()
        inspector = inspect(engine)
        if inspector.has_table(table_name):
            existing = pd.read_sql_table(table_name, engine)

        combined = pd.concat([existing, df], ignore_index=True)
        combined = _normalize_forecast_frame(combined)
        combined.to_sql(table_name, engine, index=False, if_exists="replace")
        return combined, True
    except Exception as exc:
        print(f"Database persistence skipped for {table_name}: {exc}")
        return df, False
    finally:
        engine.dispose()


def persist_unified_forecasts(
    forecast_df: pd.DataFrame, scope: str, horizon: str
) -> dict[str, object]:
    config = STORE_CONFIG[(scope, horizon)]
    normalized = _normalize_forecast_frame(forecast_df)

    _write_csv_store(normalized, config["csv_path"])
    combined, db_written = _write_database_store(normalized, config["table_name"])
    # Mirror only the current run to Supabase. The local Forecast DB keeps the
    # accumulated unified table, but pushing that full table can be slow/heavy.
    supabase_written = mirror_table_to_supabase_isolated(
        config["table_name"],
        normalized,
        timeout_seconds=600,
    )

    return {
        "csv_path": config["csv_path"],
        "table_name": config["table_name"],
        "db_written": db_written,
        "supabase_written": supabase_written,
        "row_count": len(normalized),
    }
