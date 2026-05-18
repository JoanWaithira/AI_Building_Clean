import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_FILE)

SOURCE_API_BASE_URL = os.getenv("SOURCE_API_BASE_URL")
SOURCE_API_KEY = os.getenv("SOURCE_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
SUPABASE_DATABASE_URL = os.getenv("SUPABASE_DATABASE_URL")

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
WEATHER_LAT = os.getenv("WEATHER_LAT")
WEATHER_LON = os.getenv("WEATHER_LON")
BUILDING_TIMEZONE = os.getenv("BUILDING_TIMEZONE", "UTC")