"""
Backfill Supabase from local CSV files — no VPN required.

Reads the unified forecast CSVs from data/forecasts/ and upserts all rows into
Supabase. Safe to run repeatedly — uses ON CONFLICT … DO UPDATE.

Usage:
    cd C:\\building_forecast_system
    venv\\Scripts\\python.exe backfill_supabase_from_csv.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
from sqlalchemy import text

from app.config import SUPABASE_DATABASE_URL
from app.utils.supabase_writers import (
    TABLE_CONFIG,
    _build_upsert_statement,
    _get_supabase_engine,
    _prepare_records,
)

FORECASTS_DIR = Path("data/forecasts")

CSV_TABLE_MAP = {
    "unified_local_short_term": FORECASTS_DIR / "unified_local_short_term.csv",
    "unified_local_long_term": FORECASTS_DIR / "unified_local_long_term.csv",
    "unified_global_short_term": FORECASTS_DIR / "unified_global_short_term.csv",
    "unified_global_long_term": FORECASTS_DIR / "unified_global_long_term.csv",
}

BATCH_SIZE = 2000


def backfill_table_from_csv(table_name: str, csv_path: Path) -> None:
    supa_engine = _get_supabase_engine()
    if supa_engine is None:
        print(f"  [SKIP] SUPABASE_DATABASE_URL not configured — cannot connect.")
        return

    print(f"\n=== Backfilling {table_name} from {csv_path.name} ===")

    if not csv_path.exists():
        print(f"  [SKIP] CSV not found: {csv_path}")
        return

    df = pd.read_csv(csv_path)
    if df.empty:
        print("  [SKIP] CSV is empty.")
        return

    config = TABLE_CONFIG[table_name]
    records = _prepare_records(
        df,
        ordered_columns=config["columns"],
        timestamp_columns=config["timestamp_columns"],
    )

    if not records:
        print("  [SKIP] No valid records after normalization.")
        return

    upsert_stmt = _build_upsert_statement(table_name)
    total = 0

    with supa_engine.begin() as conn:
        for ddl in config["ddl"]:
            try:
                conn.execute(text(ddl))
            except Exception:
                pass  # table / index may already exist

        for start in range(0, len(records), BATCH_SIZE):
            batch = records[start : start + BATCH_SIZE]
            conn.execute(upsert_stmt, batch)
            total += len(batch)
            print(f"  Upserted rows {start + 1}–{start + len(batch)}")

    with supa_engine.connect() as conn:
        count = conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).fetchone()[0]

    print(f"  Done — {total} rows pushed. Supabase {table_name} now has {count} rows.")


if __name__ == "__main__":
    if not SUPABASE_DATABASE_URL:
        print("[ERROR] SUPABASE_DATABASE_URL is not set in .env")
        raise SystemExit(1)

    for tbl, csv in CSV_TABLE_MAP.items():
        try:
            backfill_table_from_csv(tbl, csv)
        except Exception as exc:
            print(f"  [ERROR] {tbl}: {exc}")

    print("\nBackfill complete.")
