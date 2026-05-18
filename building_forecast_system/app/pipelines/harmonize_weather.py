from __future__ import annotations

from pathlib import Path

import pandas as pd


RAW_DIR = Path("data/raw")
PROCESSED_DIR = Path("data/processed")

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

RAW_FORECAST = RAW_DIR / "weather_forecast.csv"
RAW_HISTORY = RAW_DIR / "weather_history.csv"

OUT_FORECAST = PROCESSED_DIR / "weather_forecast_hourly.csv"
OUT_HISTORY = PROCESSED_DIR / "weather_history_hourly.csv"


def harmonize_weather_file(input_file: Path, output_file: Path) -> None:
    if not input_file.exists():
        print(f"Missing weather input file: {input_file}")
        return

    df = pd.read_csv(input_file)
    if df.empty:
        print(f"Weather input file is empty: {input_file}")
        return

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").drop_duplicates(subset=["timestamp"])

    numeric_cols = [c for c in df.columns if c != "timestamp"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.set_index("timestamp").resample("1h").mean()

    # Fill gaps in a stable way for hourly weather
    df = df.interpolate(method="time", limit_direction="both")
    df = df.ffill().bfill()

    # Guardrails
    if "humidity" in df.columns:
        df["humidity"] = df["humidity"].clip(lower=0, upper=100)
    if "clouds" in df.columns:
        df["clouds"] = df["clouds"].clip(lower=0, upper=100)
    if "wind_speed" in df.columns:
        df["wind_speed"] = df["wind_speed"].clip(lower=0)
    if "rain_1h" in df.columns:
        df["rain_1h"] = df["rain_1h"].clip(lower=0)
    if "snow_1h" in df.columns:
        df["snow_1h"] = df["snow_1h"].clip(lower=0)

    df = df.reset_index()
    df.to_csv(output_file, index=False)
    print(f"Saved harmonized weather -> {output_file}")


def run() -> None:
    harmonize_weather_file(RAW_FORECAST, OUT_FORECAST)
    harmonize_weather_file(RAW_HISTORY, OUT_HISTORY)


if __name__ == "__main__":
    run()