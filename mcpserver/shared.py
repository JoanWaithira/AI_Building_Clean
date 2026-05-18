# These are the shared helper functions for the server and the client.

import os
import re
import sys
import traceback

import httpx


# Logging function to print messages to stderr with flushing to ensure they appear immediately. This is useful for debugging and monitoring the server's activity.
def log(msg: str):
    print(msg, file=sys.stderr, flush=True)


def load_local_env_file():
    """
    Loads environment variables from a .env file located in the same directory as this script. 
    The .env file has key=value pairs, one per line. 
    Lines starting with # are treated as comments and ignored. 
    Values can be enclosed in quotes to allow for spaces or special characters. This function is useful for setting up environment variables without having to configure them in the system or pass them in the command line.
    
    """
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as file:
            for raw in file:
                line = raw.strip()
                # Skip empty lines, comments, and lines without an equals sign. This allows for a simple key=value format in the .env file, with support for comments and blank lines for readability.
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")  # Remove surrounding whitespace and quotes from the value. This allows for values to be enclosed in quotes if they contain spaces or special characters.
                if key:
                    os.environ[key] = value
    except Exception as exc:
        log(f"[env] failed to load .env file: {exc}")

def format_exception(exc: BaseException) ->str:
    """Formats an exception into a readable string, including the stack trace. This is useful for logging errors in a way that provides context about where and why the error occurred."""
    if hasattr(exc, "exceptions"):
        lines = [f"{type(exc).__name__}: {exc}"]
        # If the exception has an 'exceptions' attribute (like ExceptionGroup), include the details of each sub-exception in the output. This allows for better understanding of complex exceptions that may contain multiple underlying issues.
        for idx, sub in enumerate(getattr(exc, "exceptions", []), start=1):
            lines.append(f"\n--- sub-exception {idx} ---")
            lines.append("".join(traceback.format_exception(type(sub), sub, sub.__traceback__)))
        return "\n".join(lines)
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))


def get_institute_context_path() -> str:
    """Returns the path to the institute context file, which is expected to be located in the same directory as this script. This file may contain important information about the institute that can be used by the server or client."""
    return os.path.join(os.path.dirname(__file__), "institute_context.md")


def load_institute_context() -> str:
    path = get_institute_context_path()
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as file:
            return file.read().strip()
    except Exception as exc:
        log(f"[institute_context] failed to load institute context: {exc}")
        return ""

def get_openai_config() -> dict:
    return {
        "api_key": os.getenv("OPENAI_API_KEY", ""),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
    }

def get_mcp_url() -> str:
    return os.getenv("MCP_URL", "http://127.0.0.1:8091/mcp")


def build_internal_service_url(full_url_env: str, hostport_env: str, default_url: str, path: str = "/mcp") -> str:
    """
    Resolve a service URL from either a full URL env var or a host:port env var.

    This is handy on platforms like Render, where internal service discovery can
    provide a stable host:port value for private network communication.
    """
    full_url = os.getenv(full_url_env, "").strip()
    if full_url:
        return full_url

    hostport = os.getenv(hostport_env, "").strip()
    if hostport:
        return f"http://{hostport}{path}"

    return default_url


def get_cors_allowed_origins() -> list[str]:
    """
    Return configured CORS origins from `CORS_ALLOWED_ORIGINS`.

    Accepts either:
    - `*`
    - a single origin
    - a comma-separated list of origins
    """
    raw = os.getenv("CORS_ALLOWED_ORIGINS", "*").strip()
    if not raw:
        return ["*"]
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def get_realtime_api_config() -> dict:
    """Returns the base URL and API key for the Gate Building real-time API."""
    return {
        "base_url": os.getenv(
            "GATE_REALTIME_API_URL",
            "https://citylab.gate-ai.eu/gate-building/api",
        ),
        "api_key": os.getenv("GATE_REALTIME_API_KEY", ""),
    }


def get_forecast_db_config() -> dict:
    """Returns connection parameters for the Gate forecast PostgreSQL database."""
    return {
        "host": os.getenv("FORECAST_DB_HOST", ""),
        "port": int(os.getenv("FORECAST_DB_PORT", "")),
        "database": os.getenv("FORECAST_DB_NAME", ""),
        "user": os.getenv("FORECAST_DB_USER", ""),
        "password": os.getenv("FORECAST_DB_PASSWORD", ""),
    }


def get_supabase_config() -> dict:
    """Returns Supabase REST API connection config."""
    return {
        "url": os.getenv("SUPABASE_URL", ""),
        "key": os.getenv("SUPABASE_SECRET_KEY", ""),
    }


def get_supabase_headers() -> dict:
    """Returns the auth headers for the Supabase REST API."""
    cfg = get_supabase_config()
    return {
        "apikey": cfg["key"],
        "Authorization": f"Bearer {cfg['key']}",
    }

def validate_table_name(table: str) -> bool:
    """Validates a table name to ensure it is a non-empty string and does not contain slashes or spaces. This is important for security reasons to prevent injection attacks or malformed requests when the table name is used in API calls."""
    return isinstance(table, str) and bool(re.match(r"^[a-zA-Z0-9_\/]+$", table)) and "/" not in table and " " not in table

def normalize_limit(limit: int, max_limit: int=100) -> int:
    return max(1, min(int(limit), max_limit))

def compute_basic_stats(rows: list, column: str) -> dict:
    if not isinstance(rows, list) or not rows:
        return {"error": "no rows provided"}
    if not column or not isinstance(column, str):
        return {"error": "invalid column name"}

    values = []
    for row in rows:
        if isinstance(row, dict) and column in row and isinstance(row[column], (int, float)):
            values.append(float(row[column]))

    if not values:
        return {"error": f"no numeric values found for column '{column}'"}

    return {
        "count": len(values),
        "min": min(values),
        "max": max(values),
        "avg": sum(values) / len(values),
    }
