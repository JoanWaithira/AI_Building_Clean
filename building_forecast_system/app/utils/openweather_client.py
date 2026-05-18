from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv


BASE_ONECALL = "https://api.openweathermap.org/data/3.0/onecall"
BASE_FORECAST_25 = "https://api.openweathermap.org/data/2.5/forecast"
BASE_WEATHER_25 = "https://api.openweathermap.org/data/2.5/weather"
BASE_HISTORY = "https://history.openweathermap.org/data/2.5/history/city"


@dataclass
class OpenWeatherConfig:
    api_key: str
    lat: float
    lon: float
    timezone: str = "UTC"
    units: str = "metric"


class OpenWeatherClient:
    def __init__(self, config: OpenWeatherConfig):
        self.config = config

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code == 401:
            raise RuntimeError(
                "OpenWeather request unauthorized (401). Verify OPENWEATHER_API_KEY and ensure the key has access to One Call 3.0."
            )
        response.raise_for_status()
        return response.json()

    def fetch_hourly_forecast(self) -> pd.DataFrame:
        """
        Fetch hourly forecast from OpenWeather One Call 3.0.
        Expected output:
            timestamp, temperature, humidity, pressure, clouds, wind_speed, rain_1h, snow_1h
        """
        params = {
            "lat": self.config.lat,
            "lon": self.config.lon,
            "appid": self.config.api_key,
            "units": self.config.units,
            "exclude": "current,minutely,daily,alerts",
        }

        try:
            payload = self._get(BASE_ONECALL, params)
            hourly = payload.get("hourly", [])
        except RuntimeError as exc:
            # Fallback for API keys without One Call 3.0 entitlement.
            if "unauthorized (401)" not in str(exc).lower():
                raise

            forecast_25_params = {
                "lat": self.config.lat,
                "lon": self.config.lon,
                "appid": self.config.api_key,
                "units": self.config.units,
            }
            payload = self._get(BASE_FORECAST_25, forecast_25_params)
            hourly = payload.get("list", [])

        rows: list[dict[str, Any]] = []
        for item in hourly:
            rain_block = item.get("rain") or {}
            snow_block = item.get("snow") or {}
            rows.append(
                {
                    "timestamp": pd.to_datetime(item["dt"], unit="s", utc=True),
                    "temperature": (item.get("main") or {}).get("temp", item.get("temp")),
                    "humidity": (item.get("main") or {}).get("humidity", item.get("humidity")),
                    "pressure": (item.get("main") or {}).get("pressure", item.get("pressure")),
                    "clouds": (item.get("clouds") or {}).get("all", item.get("clouds")),
                    "wind_speed": (item.get("wind") or {}).get("speed", item.get("wind_speed")),
                    "rain_1h": rain_block.get("1h", rain_block.get("3h", 0.0)),
                    "snow_1h": snow_block.get("1h", snow_block.get("3h", 0.0)),
                }
            )

        df = pd.DataFrame(rows)
        if df.empty:
            raise ValueError("OpenWeather forecast response did not contain hourly data.")
        return df

    def fetch_current_weather(self) -> pd.DataFrame:
        """
        Fetch the current weather snapshot from OpenWeather One Call 3.0.
        This is useful for maintaining a small local historical weather store over time.
        """
        params = {
            "lat": self.config.lat,
            "lon": self.config.lon,
            "appid": self.config.api_key,
            "units": self.config.units,
            "exclude": "hourly,minutely,daily,alerts",
        }

        try:
            payload = self._get(BASE_ONECALL, params)
            current = payload.get("current", {})
        except RuntimeError as exc:
            # Fallback for API keys without One Call 3.0 entitlement.
            if "unauthorized (401)" not in str(exc).lower():
                raise

            weather_25_params = {
                "lat": self.config.lat,
                "lon": self.config.lon,
                "appid": self.config.api_key,
                "units": self.config.units,
            }
            payload = self._get(BASE_WEATHER_25, weather_25_params)
            current = payload

        if not current:
            raise ValueError("OpenWeather current response did not contain current data.")

        rain_block = current.get("rain") or {}
        snow_block = current.get("snow") or {}

        row = {
            "timestamp": pd.to_datetime(current["dt"], unit="s", utc=True),
            "temperature": (current.get("main") or {}).get("temp", current.get("temp")),
            "humidity": (current.get("main") or {}).get("humidity", current.get("humidity")),
            "pressure": (current.get("main") or {}).get("pressure", current.get("pressure")),
            "clouds": (current.get("clouds") or {}).get("all", current.get("clouds")),
            "wind_speed": (current.get("wind") or {}).get("speed", current.get("wind_speed")),
            "rain_1h": rain_block.get("1h", rain_block.get("3h", 0.0)),
            "snow_1h": snow_block.get("1h", snow_block.get("3h", 0.0)),
        }

        return pd.DataFrame([row])


def build_client_from_env() -> OpenWeatherClient:
    load_dotenv()

    api_key = os.getenv("OPENWEATHER_API_KEY")
    lat = os.getenv("BUILDING_LAT") or os.getenv("WEATHER_LAT")
    lon = os.getenv("BUILDING_LON") or os.getenv("WEATHER_LON")
    timezone = os.getenv("BUILDING_TIMEZONE", "UTC")

    if not api_key:
        raise ValueError("Missing OPENWEATHER_API_KEY in .env")
    if not lat:
        raise ValueError("Missing BUILDING_LAT in .env")
    if not lon:
        raise ValueError("Missing BUILDING_LON in .env")

    return OpenWeatherClient(
        OpenWeatherConfig(
            api_key=api_key,
            lat=float(lat),
            lon=float(lon),
            timezone=timezone,
            units="metric",
        )
    )