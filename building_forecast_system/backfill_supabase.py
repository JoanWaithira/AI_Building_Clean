"""
One-time backfill: push all local forecast rows to Supabase.
This catches up any rows that were missed when the Supabase connection was unavailable.
Safe to run repeatedly — uses UPSERT (ON CONFLICT … DO UPDATE).
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import text

from app.db import engine as local_engine
from app.utils.supabase_writers import (
    TABLE_CONFIG,
    _build_upsert_statement,
    _get_supabase_engine,
    _prepare_records,
)

BATCH_SIZE = 2000

TABLES_TO_BACKFILL = [
    "forecast_short_term",
    "forecast_long_term",
    "forecast_global",
    "unified_local_short_term",
    "unified_local_long_term",
    "unified_global_short_term",
    "unified_global_long_term",
]


def backfill_table(table_name: str) -> None:
    supa_engine = _get_supabase_engine()
    if supa_engine is None:
        print("  SUPABASE_DATABASE_URL not configured — skipping.")
        return

    config = TABLE_CONFIG[table_name]

    print(f"\n=== Backfilling {table_name} ===")

    # Read local rows
    with local_engine.connect() as conn:
        local_df = pd.read_sql(f"SELECT * FROM {table_name}", conn)
    print(f"  Local rows: {len(local_df)}")

    if local_df.empty:
        print("  Nothing to backfill.")
        return

    records = _prepare_records(
        local_df,
        ordered_columns=config["columns"],
        timestamp_columns=config["timestamp_columns"],
    )

    # Ensure DDL + UPSERT in batches
    upsert_stmt = _build_upsert_statement(table_name)
    total = 0
    with supa_engine.begin() as conn:
        for ddl in config["ddl"]:
            conn.execute(text(ddl))

        for start in range(0, len(records), BATCH_SIZE):
            batch = records[start : start + BATCH_SIZE]
            conn.execute(upsert_stmt, batch)
            total += len(batch)
            print(f"  Upserted batch {start // BATCH_SIZE + 1} ({len(batch)} rows)")

    # Verify
    with supa_engine.connect() as conn:
        supa_count = conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).fetchone()[0]
    print(f"  Backfill complete. Supabase now has {supa_count} rows.\n")


if __name__ == "__main__":
    for table in TABLES_TO_BACKFILL:
        try:
            backfill_table(table)
        except Exception as exc:
            print(f"  ERROR backfilling {table}: {exc}")
