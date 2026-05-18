"""Forecast providers package."""

from app.providers.csv_forecast_provider import CsvForecastProvider
from app.providers.db_forecast_provider import DbForecastProvider
from app.providers.fallback_forecast_provider import FallbackForecastProvider
from app.providers.forecast_provider import ForecastProvider
from app.providers.supabase_rest_forecast_provider import SupabaseRestForecastProvider

__all__ = [
    "ForecastProvider",
    "DbForecastProvider",
    "SupabaseRestForecastProvider",
    "CsvForecastProvider",
    "FallbackForecastProvider",
]
