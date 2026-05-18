from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.pipelines.global_features_hourly import merge_global_with_weather


PROCESSED_DIR = Path("data/processed")
OUTPUT_FILE = PROCESSED_DIR / "global_hourly_clean.csv"
WEATHER_FILE = PROCESSED_DIR / "weather_history_hourly.csv"


def run() -> None:
    files = [f for f in PROCESSED_DIR.glob("*_clean.csv") if f.name not in {"global_clean.csv", "global_hourly_clean.csv"}]

    if not files:
        print("No cleaned circuit files found in data/processed.")
        return

    merged = None

    for file in files:
        circuit_id = file.name.replace("_clean.csv", "")

        df = pd.read_csv(file)
        if "timestamp" not in df.columns or "value" not in df.columns:
            print(f"Skipping invalid circuit file: {file}")
            continue

        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df[["timestamp", "value"]].sort_values("timestamp")
        df = df.drop_duplicates(subset=["timestamp"])

        # Resample every circuit to hourly mean
        df = (
            df.set_index("timestamp")
            .resample("1h")
            .mean()
            .rename(columns={"value": circuit_id})
            .reset_index()
        )

        if merged is None:
            merged = df
        else:
            merged = merged.merge(df, on="timestamp", how="outer")

    if merged is None or merged.empty:
        print("No valid circuit data found.")
        return

    merged = merged.sort_values("timestamp")
    merged = merged.fillna(0)

    value_cols = [c for c in merged.columns if c != "timestamp"]
    merged["value"] = merged[value_cols].sum(axis=1)

    global_df = merged[["timestamp", "value"]].copy()

    if WEATHER_FILE.exists():
        weather_df = pd.read_csv(WEATHER_FILE)
        global_df = merge_global_with_weather(global_df, weather_df)
        print(f"Merged weather from {WEATHER_FILE}")
    else:
        print(f"Weather file not found: {WEATHER_FILE}. Building global series without weather.")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    global_df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved hourly global series -> {OUTPUT_FILE}")


if __name__ == "__main__":
    run()