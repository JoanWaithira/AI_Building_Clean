import os
from pathlib import Path

FORECAST_CSV_DIR = os.getenv(
    "FORECAST_CSV_DIR",
    "c:\\building_forecast_system\\data\\forecasts"
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:password@host:5432/gate_forecasts"
)

ENABLE_DB_PROVIDER = os.getenv("ENABLE_DB_PROVIDER", "true").lower() == "true"
ENABLE_CSV_PROVIDER = os.getenv("ENABLE_CSV_PROVIDER", "true").lower() == "true"

DB_QUERY_TIMEOUT = int(os.getenv("DB_QUERY_TIMEOUT", "30"))
CSV_FILE_CHECK_INTERVAL = int(os.getenv("CSV_FILE_CHECK_INTERVAL", "300"))

CLIENT_CACHE_TTL = int(os.getenv("CLIENT_CACHE_TTL", "60"))
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
DB_POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "1800"))

TIMESTAMP_FIELD_PRIORITY = ["forecast_timestamp", "timestamp"]
VALUE_FIELD_PRIORITY = ["forecast_value", "predicted_value", "value"]
CIRCUIT_FIELD_PRIORITY = ["circuit_id", "meter"]

DEFAULT_CIRCUIT_FOR_GLOBAL = "global"
DEFAULT_MODEL_TYPE = "unknown"
DEFAULT_MODEL_VERSION = "unknown"

DEDUP_KEY_FIELDS = ["circuit_id", "forecast_timestamp", "resolution"]
DEDUP_PRIORITY = "latest_generated_at"

CSV_FILE_MAPPINGS = {
    ("local", "short_term"): "unified_local_short_term.csv",
    ("local", "long_term"): "unified_local_long_term.csv",
    ("global", "short_term"): "unified_global_short_term.csv",
    ("global", "long_term"): "unified_global_long_term.csv",
}

DB_TABLE_MAPPINGS = {
    ("local", "short_term"): "public.unified_local_short_term",
    ("local", "long_term"): "public.unified_local_long_term",
    ("global", "short_term"): "public.unified_global_short_term",
    ("global", "long_term"): "public.unified_global_long_term",
}

PROVIDER_LOG_LEVEL = os.getenv("PROVIDER_LOG_LEVEL", "INFO")
LOG_QUERY_PERFORMANCE = os.getenv("LOG_QUERY_PERFORMANCE", "true").lower() == "true"

MAX_FORECAST_RECORDS = int(os.getenv("MAX_FORECAST_RECORDS", "100000"))
ENABLE_AUTO_REFRESH = os.getenv("ENABLE_AUTO_REFRESH", "true").lower() == "true"
AUTO_REFRESH_INTERVAL = int(os.getenv("AUTO_REFRESH_INTERVAL", "300"))

SILENT_FAIL_ON_NO_DATA = os.getenv("SILENT_FAIL_ON_NO_DATA", "true").lower() == "true"
MAX_DB_RETRIES = int(os.getenv("MAX_DB_RETRIES", "1"))

FEATURE_CSV_FALLBACK = os.getenv("FEATURE_CSV_FALLBACK", "true").lower() == "true"
FEATURE_SOURCE_TRACKING = os.getenv("FEATURE_SOURCE_TRACKING", "true").lower() == "true"
FEATURE_VALIDATE_SCHEMA = os.getenv("FEATURE_VALIDATE_SCHEMA", "true").lower() == "true"

VALID_SCOPES = ["local", "global"]
VALID_PRODUCTS = ["short_term", "long_term"]
VALID_MODES = ["single", "compare"]

MAX_RECORDS_PER_QUERY = 100000
MIN_FORECAST_VALUE = None
MAX_FORECAST_VALUE = None

ALERT_ON_DB_FAILURE_COUNT = int(os.getenv("ALERT_ON_DB_FAILURE_COUNT", "3"))
ALERT_ON_FALLBACK_RATE = int(os.getenv("ALERT_ON_FALLBACK_RATE", "10"))


def get_csv_path(scope: str, product: str) -> str:
    filename = CSV_FILE_MAPPINGS.get((scope, product))
    if not filename:
        raise ValueError(f"No CSV mapping for scope={scope}, product={product}")
    return os.path.join(FORECAST_CSV_DIR, filename)


def get_db_table(scope: str, product: str) -> str:
    table = DB_TABLE_MAPPINGS.get((scope, product))
    if not table:
        raise ValueError(f"No table mapping for scope={scope}, product={product}")
    return table


def is_valid(scope: str = None, product: str = None, mode: str = None) -> bool:
    if scope and scope not in VALID_SCOPES:
        return False
    if product and product not in VALID_PRODUCTS:
        return False
    if mode and mode not in VALID_MODES:
        return False
    return True
