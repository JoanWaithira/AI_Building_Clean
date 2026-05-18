import argparse
import asyncio
import json
import os
import re
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.fastmcp import FastMCP


# ================================
# HELPERS
# ================================

def log(msg: str):
    print(msg, file=sys.stderr, flush=True)


def load_local_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return

    try:
        with open(env_path, "r", encoding="utf-8") as file:
            for raw in file:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    os.environ[key] = value
    except Exception as exc:
        log(f"[env] failed to load .env: {exc}")


def format_exception(exc: BaseException) -> str:
    if hasattr(exc, "exceptions"):
        lines = [f"{type(exc).__name__}: {exc}"]
        for idx, sub in enumerate(getattr(exc, "exceptions", []), start=1):
            lines.append(f"\n--- sub-exception {idx} ---")
            lines.append("".join(traceback.format_exception(type(sub), sub, sub.__traceback__)))
        return "\n".join(lines)
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))


def get_institute_context_path() -> str:
    return os.path.join(os.path.dirname(__file__), "institute_context.md")


def load_institute_context() -> str:
    path = get_institute_context_path()
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as file:
            return file.read().strip()
    except Exception as exc:
        log(f"[context] failed to load institute context: {exc}")
        return ""


# ================================
# CONFIG
# ================================

def get_openai_config() -> dict:
    return {
        "api_key": os.getenv("OPENAI_API_KEY", ""),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
    }


def get_mcp_url() -> str:
    return os.getenv("MCP_URL", "http://127.0.0.1:8091/mcp")


def get_cesium_mcp_url() -> str:
    return os.getenv("CESIUM_MCP_URL", "http://127.0.0.1:8092/mcp")


def get_postgrest_base(api: str) -> str | None:
    mapping = {
        "3000": os.getenv("POSTGREST_3000", "http://127.0.0.1:3000"),
        "3001": os.getenv("POSTGREST_3001", "http://127.0.0.1:3001"),
    }
    return mapping.get(api)


# ================================
# OPENAI / MCP CLIENTS
# ================================

async def call_openai(messages: list[dict]) -> str:
    cfg = get_openai_config()
    if not cfg["api_key"]:
        raise RuntimeError("Missing OPENAI_API_KEY in environment (.env).")

    payload = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=40) as client:
        response = await client.post(f"{cfg['base_url']}/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"]


async def call_mcp_tool(tool_name: str, arguments: dict):
    mcp_url = get_mcp_url()
    try:
        async with streamable_http_client(mcp_url) as client_parts:
            read = client_parts[0]
            write = client_parts[1]
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(tool_name, arguments)
    except Exception as exc:
        log(f"[mcp] tool call failed ({tool_name}, args={arguments}):\n" + format_exception(exc))
        raise


async def call_cesium_mcp_tool(tool_name: str, arguments: dict):
    mcp_url = get_cesium_mcp_url()
    try:
        async with streamable_http_client(mcp_url) as client_parts:
            read = client_parts[0]
            write = client_parts[1]
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(tool_name, arguments)
    except Exception as exc:
        log(f"[cesium-mcp] tool call failed ({tool_name}, args={arguments}):\n" + format_exception(exc))
        raise


# ================================
# POSTGREST HELPERS (shared by MCP tools)
# ================================

def validate_table_name(table: str) -> bool:
    return isinstance(table, str) and bool(table) and "/" not in table and " " not in table


def normalize_limit(limit: int, max_limit: int = 100) -> int:
    return max(1, min(int(limit), max_limit))


def normalize_order_by(order_by: str | None) -> str | None:
    if not order_by:
        return None
    value = str(order_by).strip()
    if not value:
        return None
    if value.startswith("-"):
        col = value[1:].strip()
        return f"{col}.desc" if col else None
    if value.endswith(".asc") or value.endswith(".desc"):
        return value
    return f"{value}.asc"


async def get_postgrest_api(api: str) -> dict:
    base = get_postgrest_base(api)
    if not base:
        return {"error": "invalid api (use '3000' or '3001')"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{base}/")
        response.raise_for_status()
        return response.json()


async def get_postgrest_rows(api: str, table: str, limit: int = 10, order_by: str | None = None):
    base = get_postgrest_base(api)
    if not base:
        return [{"error": "invalid api (use '3000' or '3001')"}]
    if not validate_table_name(table):
        return [{"error": "invalid table name"}]

    params = {"limit": normalize_limit(limit)}
    normalized_order = normalize_order_by(order_by)
    if normalized_order:
        params["order"] = normalized_order

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{base}/{table}", params=params)
        response.raise_for_status()
        return response.json()


def infer_order_column(sample_rows: list) -> str | None:
    if not isinstance(sample_rows, list) or not sample_rows or not isinstance(sample_rows[0], dict):
        return None
    lowered_keys = {str(key).lower(): key for key in sample_rows[0].keys()}
    preferred = ["timestamp", "datetime", "created_at", "updated_at", "date", "time", "id", "room_id"]
    for candidate in preferred:
        if candidate in lowered_keys:
            return lowered_keys[candidate]
    return None


def _extract_count(content_range: str | None) -> int | None:
    if not content_range:
        return None
    match = re.search(r"/(\d+)$", content_range.strip())
    if not match:
        return None
    return int(match.group(1))


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


# ================================
# MCP SERVER (TOOLS)
# ================================

mcp = FastMCP("postgrest")


@mcp.tool()
async def list_tables(api: str) -> str:
    data = await get_postgrest_api(api)
    if "paths" not in data:
        return data.get("error", "Unexpected API response format.")

    items = []
    for path in data["paths"].keys():
        if path != "/" and isinstance(path, str) and path.startswith("/"):
            items.append(path.strip("/").split("?")[0])
    return "\n".join(sorted(set(items)))


@mcp.tool()
async def get_rows(api: str, table: str, limit: int = 10, order_by: str | None = None) -> str:
    rows = await get_postgrest_rows(api, table, limit=limit, order_by=order_by)
    if rows and isinstance(rows, list) and isinstance(rows[0], dict) and "error" in rows[0]:
        return f"Error: {rows[0]['error']}"
    return json.dumps(rows, indent=2)


@mcp.tool()
async def count_rows(api: str, table: str) -> str:
    base = get_postgrest_base(api)
    if not base:
        return "invalid api (use '3000' or '3001')"
    if not validate_table_name(table):
        return "invalid table name"

    headers = {"Prefer": "count=exact", "Range": "0-0"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{base}/{table}", params={"select": "*"}, headers=headers)
        response.raise_for_status()
    total = _extract_count(response.headers.get("content-range"))
    return str(total) if total is not None else "count unavailable"


@mcp.tool()
async def get_last_rows(api: str, table: str, limit: int = 10, order_by: str | None = None) -> str:
    base = get_postgrest_base(api)
    if not base:
        return "invalid api (use '3000' or '3001')"
    if not validate_table_name(table):
        return "invalid table name"

    limit = normalize_limit(limit)

    detected_order = None
    if not order_by:
        async with httpx.AsyncClient(timeout=20.0) as client:
            sample = await client.get(f"{base}/{table}", params={"limit": 1})
            sample.raise_for_status()
            detected_order = infer_order_column(sample.json())

    rows = await get_postgrest_rows(
        api,
        table,
        limit=limit,
        order_by=order_by or (f"{detected_order}.desc" if detected_order else None),
    )
    if rows and isinstance(rows, list) and isinstance(rows[0], dict) and "error" in rows[0]:
        return f"Error: {rows[0]['error']}"

    return json.dumps(
        {
            "table": table,
            "limit": limit,
            "order_by": normalize_order_by(order_by) or (f"{detected_order}.desc" if detected_order else None),
            "rows": rows,
        },
        indent=2,
    )


@mcp.tool()
async def basic_stats(api: str, table: str, column: str, limit: int = 50, order_by: str | None = None) -> str:
    rows = await get_postgrest_rows(api, table, limit=limit, order_by=order_by)
    if rows and isinstance(rows, list) and isinstance(rows[0], dict) and "error" in rows[0]:
        return f"Error: {rows[0]['error']}"

    stats = compute_basic_stats(rows, column)
    if "error" in stats:
        return f"Error: {stats['error']}"

    return (
        f"Stats for {table}.{column} (n={stats['count']}):\n"
        f"min={stats['min']}\n"
        f"max={stats['max']}\n"
        f"avg={stats['avg']}"
    )


# ================================
# CHAT LOGIC
# ================================

async def generate_chat_reply(message: str, history: list | None = None) -> dict:
    msg = message.strip()
    low = msg.lower()

    normalized_history = []
    if isinstance(history, list):
        for item in history:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "")).strip().lower()
            content = str(item.get("content", "")).strip()
            if role in {"user", "assistant", "system"} and content:
                normalized_history.append({"role": role, "content": content})

    institute_context = load_institute_context()

    def extract_text_content(tool_res) -> str | None:
        content = getattr(tool_res, "content", None)
        if not isinstance(content, list) or not content:
            return None
        first = getattr(content[0], "text", None)
        return first.strip() if isinstance(first, str) and first.strip() else None

    def parse_cesium_command(tool_res) -> dict | None:
        text = extract_text_content(tool_res)
        if not text:
            return None
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    def summarize_rows_for_llm(rows_text: str):
        try:
            parsed = json.loads(rows_text)
        except Exception:
            return rows_text
        if isinstance(parsed, list):
            return parsed[:20]
        return parsed if isinstance(parsed, dict) else rows_text

    def build_openai_messages(extra_system_parts: list[str] | None = None) -> list[dict]:
        system_parts = [
            "You are a building and institute assistant.",
            "Use MCP tool evidence as primary factual source whenever provided.",
            "If MCP evidence is provided, do not contradict it and avoid unnecessary clarification questions.",
            "If MCP evidence JSON is present, never claim evidence is missing; use it directly.",
            "When rows are provided, explain key values clearly and concisely.",
        ]
        if institute_context:
            system_parts.append("Institute context:\n" + institute_context)
        if extra_system_parts:
            system_parts.extend(extra_system_parts)

        messages = [{"role": "system", "content": "\n\n".join(system_parts)}]
        messages.extend(normalized_history[-8:])
        if not normalized_history or normalized_history[-1].get("role") != "user" or normalized_history[-1].get("content") != msg:
            messages.append({"role": "user", "content": msg})
        return messages

    async def llm_middleman_reply(mcp_payload: dict, task_instruction: str, fallback_text: str) -> str:
        extra_parts = [
            "MCP evidence JSON (trusted factual data):\n" + json.dumps(mcp_payload, indent=2, ensure_ascii=False),
            "Task:\n" + task_instruction,
        ]
        try:
            reply = await call_openai(build_openai_messages(extra_parts))
            low_reply = reply.lower()
            has_strong_evidence = any(key in mcp_payload for key in ("rows", "tables", "row_count", "room_count", "room_names"))
            if has_strong_evidence and any(
                phrase in low_reply
                for phrase in (
                    "no evidence",
                    "cannot display",
                    "not available",
                    "i don't have",
                    "i do not have",
                )
            ):
                return fallback_text
            return reply
        except Exception as exc:
            log("[chat] llm middleman fallback:\n" + format_exception(exc))
            return fallback_text

    async def get_mcp_tables_by_api() -> dict[str, list[str]]:
        tables_by_api: dict[str, list[str]] = {}
        for api in ("3000", "3001"):
            try:
                response = await call_mcp_tool("list_tables", {"api": api})
                text = extract_text_content(response)
                if not text:
                    continue
                tables = sorted(set(line.strip() for line in text.splitlines() if line.strip()))
                if tables:
                    tables_by_api[api] = tables
            except Exception as exc:
                log(f"[chat] mcp precheck failed for api={api}:\n" + format_exception(exc))
        return tables_by_api

    def find_table_in_text(text: str, tables_by_api: dict[str, list[str]]) -> tuple[str, str] | tuple[None, None]:
        normalized = re.sub(r"[^a-z0-9_/]+", " ", text.lower())
        haystack = f" {normalized} "
        for api in ("3000", "3001"):
            for table in tables_by_api.get(api, []):
            # allow underscores and avoid partial matches
                pattern = rf"(?<![a-z0-9_]){re.escape(table.lower())}(?![a-z0-9_])"
                if re.search(pattern, low):
                    return api, table
        return None, None

    def is_tables_request(text: str) -> bool:
        return "tables" in text or "what tables exist" in text or "which tables exist" in text

    tables_by_api = await get_mcp_tables_by_api()
    mcp_available = any(tables_by_api.values())
    log(f"[chat] mcp precheck available={mcp_available} apis={list(tables_by_api.keys())}")

    room_match = re.search(r"\b(?:room|rm)\s+([A-Za-z0-9.\-_]+)\b", msg, re.IGNORECASE)
    floor_match = re.search(r"\bfloor\s+(\d+)\b", msg, re.IGNORECASE)

    asks_zoom = any(token in low for token in ("zoom", "fly", "go to", "focus", "show"))
    asks_building = any(token in low for token in ("building", "whole building", "full building"))
    asks_reset = any(token in low for token in ("reset", "home view", "default view"))
    asks_rows_like = any(token in low for token in ("rows", "records", "entries", "table"))

    if not asks_rows_like:
        try:
            if asks_reset or (asks_zoom and asks_building):
                tool_res = await call_cesium_mcp_tool("zoom_to_building", {})
                cmd = parse_cesium_command(tool_res)
                if cmd:
                    return {"reply": "Zooming to the full building.", "cesiumCommand": cmd}

            if room_match and asks_zoom:
                room_number = room_match.group(1)
                tool_res = await call_cesium_mcp_tool("zoom_to_room", {"room_number": room_number})
                cmd = parse_cesium_command(tool_res)
                if cmd:
                    return {"reply": f"Zooming to room {room_number}.", "cesiumCommand": cmd}

            if floor_match and asks_zoom:
                floor = int(floor_match.group(1))
                tool_res = await call_cesium_mcp_tool("zoom_to_floor", {"floor": floor})
                cmd = parse_cesium_command(tool_res)
                if cmd:
                    return {"reply": f"Zooming to floor {floor}.", "cesiumCommand": cmd}
        except Exception as exc:
            log("[chat] cesium routing failed:\n" + format_exception(exc))

    if mcp_available and is_tables_request(low):
        merged = []
        seen = set()
        for api in ("3000", "3001"):
            for table in tables_by_api.get(api, []):
                key = table.lower()
                if key in seen:
                    continue
                seen.add(key)
                merged.append(table)
        fallback_text = "Database tables:\n" + "\n".join(merged)
        payload = {"intent": "list_tables", "query": msg, "tables": merged, "tables_by_api": tables_by_api}
        return {"reply": await llm_middleman_reply(payload, "Return table names in a readable list.", fallback_text)}

    if mcp_available:
        target_api, target_table = find_table_in_text(low, tables_by_api)

        if low.startswith("rows ") and not target_api:
            requested = msg.split(" ", 1)[1].strip().lower()
            target_api, target_table = find_table_in_text(requested, tables_by_api)
            if not target_api:
                target_api, target_table = "3000", msg.split(" ", 1)[1].strip()

        if target_api and target_table:
            asks_last = any(token in low for token in ("last", "latest", "recent"))
            asks_rows = any(token in low for token in ("rows", "records", "entries", "values", "list", "show"))
            asks_count = ("how many" in low) or ("count" in low)

            if asks_count:
                count_res = await call_mcp_tool("count_rows", {"api": target_api, "table": target_table})
                count_text = extract_text_content(count_res)
                if count_text:
                    fallback_text = f"`{target_table}` has {count_text} rows."
                    payload = {
                        "intent": "table_count",
                        "query": msg,
                        "table": target_table,
                        "api": target_api,
                        "row_count": count_text,
                    }
                    return {"reply": await llm_middleman_reply(payload, "Answer count question with table name.", fallback_text)}

            if asks_rows:
                tool = "get_last_rows" if asks_last else "get_rows"
                limit = 20 if asks_last else 20
                rows_res = await call_mcp_tool(tool, {"api": target_api, "table": target_table, "limit": limit})
                rows_text = extract_text_content(rows_res)
                if rows_text:
                    label = "Last rows" if asks_last else "Rows"
                    fallback_text = f"{label} from `{target_table}`:\n{rows_text}"
                    payload = {
                        "intent": "table_last_rows" if asks_last else "table_rows",
                        "query": msg,
                        "table": target_table,
                        "api": target_api,
                        "rows": summarize_rows_for_llm(rows_text),
                    }
                    return {
                        "reply": await llm_middleman_reply(
                            payload,
                            "Present row values clearly and mention source table. If last rows were requested, state that explicitly.",
                            fallback_text,
                        )
                    }

    fallback_parts = [
        "MCP tools were checked first. No confident MCP route was found for this query.",
        "Provide a best-effort answer and avoid inventing database facts.",
    ]
    return {"reply": await call_openai(build_openai_messages(fallback_parts))}


# ================================
# CHAT API HTTP SERVER
# ================================

class ChatHandler(BaseHTTPRequestHandler):
    server_version = "ChatAPI/1.0"

    def _send_json(self, status_code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/chat":
            self._send_json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        message = data.get("message") if isinstance(data, dict) else None
        history = data.get("history") if isinstance(data, dict) else None
        if not isinstance(message, str) or not message.strip():
            self._send_json(400, {"error": "'message' must be a non-empty string"})
            return

        log(f"[chat] incoming message: {message.strip()}")
        try:
            result = asyncio.run(generate_chat_reply(message.strip(), history))
            if isinstance(result, dict):
                self._send_json(200, result)
            else:
                self._send_json(200, {"reply": str(result)})
        except Exception as exc:
            detail = format_exception(exc)
            log("[chat] ERROR:\n" + detail)
            self._send_json(500, {"error": "internal error", "detail": detail[:2000]})


def run_chat_api(host: str, port: int):
    log(f"Chat API running http://{host}:{port}")
    ThreadingHTTPServer((host, port), ChatHandler).serve_forever()


# ================================
# MAIN
# ================================

if __name__ == "__main__":
    load_local_env_file()

    parser = argparse.ArgumentParser(description="MCP server + Chat API")
    parser.add_argument("--chat-api", action="store_true", help="Run Chat HTTP API on /chat")
    parser.add_argument("--mcp-http", action="store_true", help="Run MCP over HTTP (streamable-http)")
    parser.add_argument("--chat-host", default=os.getenv("CHAT_API_HOST", "127.0.0.1"))
    parser.add_argument("--chat-port", type=int, default=int(os.getenv("CHAT_API_PORT", "8010")))
    parser.add_argument("--mcp-host", default=os.getenv("MCP_HOST", "127.0.0.1"))
    parser.add_argument("--mcp-port", type=int, default=int(os.getenv("MCP_PORT", "8091")))
    args = parser.parse_args()

    if args.chat_api:
        run_chat_api(args.chat_host, args.chat_port)
    elif args.mcp_http:
        mcp.settings.host = args.mcp_host
        mcp.settings.port = args.mcp_port
        log(f"MCP HTTP running {args.mcp_host}:{args.mcp_port} (path: /mcp)")
        mcp.run(transport="streamable-http")
    else:
        log("MCP running stdio")
        mcp.run()