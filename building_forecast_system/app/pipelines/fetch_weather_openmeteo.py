import os
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv


FORECAST_FILE = Path("data/processed/weather_forecast_hourly.csv")
FORECAST_FILE.parent.mkdir(parents=True, exist_ok=True)


def main():
    load_dotenv()

    lat = os.getenv("BUILDING_LAT") or os.getenv("WEATHER_LAT")
    lon = os.getenv("BUILDING_LON") or os.getenv("WEATHER_LON")

    if not lat or not lon:
        raise ValueError(
            "Missing BUILDING_LAT/BUILDING_LON or WEATHER_LAT/WEATHER_LON in .env"
        )

    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "pressure_msl",
                "cloudcover",
                "wind_speed_10m",
                "precipitation",
                "rain",
                "snowfall",
            ]
        ),
        "forecast_days": 7,
        "timezone": "UTC",
    }

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    hourly = data["hourly"]
    df = pd.DataFrame(hourly)

    df.rename(
        columns={
            "temperature_2m": "temperature",
            "relative_humidity_2m": "humidity",
            "pressure_msl": "pressure",
            "cloudcover": "clouds",
            "wind_speed_10m": "wind_speed",
            "precipitation": "precipitation",
            "rain": "rain_1h",
            "snowfall": "snow_1h",
        },
        inplace=True,
    )

    df["timestamp"] = pd.to_datetime(df["time"], utc=True)
    df = df.drop(columns=["time"])

    cols = [
        "timestamp",
        "temperature",
        "humidity",
        "pressure",
        "clouds",
        "wind_speed",
        "rain_1h",
        "snow_1h",
    ]

    df[cols].to_csv(FORECAST_FILE, index=False)

    print(f"Saved Open-Meteo weather forecast -> {FORECAST_FILE}", flush=True)


if __name__ == "__main__":
    main()
