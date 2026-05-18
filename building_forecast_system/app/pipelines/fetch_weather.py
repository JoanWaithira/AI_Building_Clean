import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

RAW_DIR = Path("data/raw")
RAW_DIR.mkdir(parents=True, exist_ok=True)

FORECAST_FILE = RAW_DIR / "weather_forecast.csv"
HISTORY_FILE = RAW_DIR / "weather_history.csv"


def _get_location():
    load_dotenv()

    lat = os.getenv("BUILDING_LAT") or os.getenv("WEATHER_LAT")
    lon = os.getenv("BUILDING_LON") or os.getenv("WEATHER_LON")
    timezone_name = os.getenv("BUILDING_TIMEZONE", "Europe/Sofia")

    if not lat or not lon:
        raise ValueError(
            "Missing BUILDING_LAT/BUILDING_LON or WEATHER_LAT/WEATHER_LON in .env"
        )

    return lat, lon, timezone_name


def _normalize_weather_df(df: pd.DataFrame) -> pd.DataFrame:
    df.rename(
        columns={
            "time": "timestamp",
            "temperature_2m": "temperature",
            "relative_humidity_2m": "humidity",
            "pressure_msl": "pressure",
            "cloud_cover": "clouds",
            "cloudcover": "clouds",
            "wind_speed_10m": "wind_speed",
            "precipitation": "precipitation",
            "rain": "rain_1h",
            "snowfall": "snow_1h",
        },
        inplace=True,
    )

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    cols = [
        "timestamp",
        "temperature",
        "humidity",
        "pressure",
        "clouds",
        "wind_speed",
        "precipitation",
        "rain_1h",
        "snow_1h",
    ]

    for col in cols:
        if col not in df.columns:
            df[col] = 0

    return df.reindex(columns=cols).copy()


def _get_with_retries(url: str, params: dict, retries: int = 3, timeout: int = 60):

    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            print(
                f"Open-Meteo request failed, attempt {attempt}/{retries}: {exc}",
                flush=True,
            )

            if attempt == retries:
                raise

            time.sleep(10 * attempt)

    raise RuntimeError("Open-Meteo request failed after retries")


def fetch_history(days_back: int = 30) -> pd.DataFrame:
    lat, lon, timezone_name = _get_location()

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=days_back)

    url = "https://archive-api.open-meteo.com/v1/archive"

    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "pressure_msl",
                "cloud_cover",
                "wind_speed_10m",
                "precipitation",
                "rain",
                "snowfall",
            ]
        ),
        "timezone": timezone_name,
    }

    print(
        f"Fetching Open-Meteo weather history from {start_date} to {end_date}",
        flush=True,
    )

    response = _get_with_retries(url, params)

    hourly = response.json().get("hourly", {})
    if not hourly:
        raise ValueError(
            "Open-Meteo history response did not include hourly weather data"
        )

    return _normalize_weather_df(pd.DataFrame(hourly))


def fetch_forecast() -> pd.DataFrame:
    lat, lon, timezone_name = _get_location()

    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "pressure_msl",
                "cloud_cover",
                "wind_speed_10m",
                "precipitation",
                "rain",
                "snowfall",
            ]
        ),
        "forecast_days": 7,
        "timezone": timezone_name,
    }

    print("Fetching Open-Meteo weather forecast", flush=True)

    response = _get_with_retries(url, params)

    hourly = response.json().get("hourly", {})
    if not hourly:
        raise ValueError(
            "Open-Meteo forecast response did not include hourly weather data"
        )

    return _normalize_weather_df(pd.DataFrame(hourly))


def run(days_back: int = 30) -> None:
    history_df = fetch_history(days_back=days_back)
    history_df.to_csv(HISTORY_FILE, index=False)
    print(f"Saved Open-Meteo weather history -> {HISTORY_FILE}", flush=True)
    print(f"History rows: {len(history_df)}", flush=True)

    forecast_df = fetch_forecast()
    forecast_df.to_csv(FORECAST_FILE, index=False)
    print(f"Saved Open-Meteo weather forecast -> {FORECAST_FILE}", flush=True)
    print(f"Forecast rows: {len(forecast_df)}", flush=True)


if __name__ == "__main__":
    run()
