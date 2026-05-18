import json
import argparse

import asyncpg
import httpx
import re
import os
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import Request as MCPRequest
from shared import (
    compute_basic_stats,
    get_forecast_db_config,
    get_realtime_api_config,
    get_supabase_config,
    get_supabase_headers,
    load_local_env_file,
    log,
    normalize_limit,
    validate_table_name,
)

mcp = FastMCP(
    "gate-building",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


from mcp.types import Request as MCPRequest, TextContent
from mcp.server.fastmcp import Context


class MCPResponse:
    def __init__(self, output: dict):
        self.output = output



# SUPABASE REST HELPERS (published forecast tables  QA / sharing layer)

SUPABASE_TABLES = {
    "forecast_global",
    "forecast_long_term",
    "forecast_short_term",
    "unified_global_long_term",
    "unified_global_short_term",
    "unified_local_long_term",
    "unified_local_short_term",
}


async def _supabase_get(table: str, params: dict | None = None, headers_extra: dict | None = None) -> list | dict:
    """GET rows from a Supabase REST API table."""
    cfg = get_supabase_config()
    if not cfg["key"]:
        return [{"error": "SUPABASE_SECRET_KEY is not configured in .env"}]
    if not validate_table_name(table):
        return [{"error": "invalid table name"}]

    headers = get_supabase_headers()
    if headers_extra:
        headers.update(headers_extra)
    url = f"{cfg['url']}/rest/v1/{table}"

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers, params=params or {})
        response.raise_for_status()
        return response.json()


async def _supabase_openapi() -> dict:
    """Fetch the Supabase REST OpenAPI schema to discover tables."""
    cfg = get_supabase_config()
    if not cfg["key"]:
        return {"error": "SUPABASE_SECRET_KEY is not configured in .env"}
    headers = get_supabase_headers()
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{cfg['url']}/rest/v1/", headers=headers)
        response.raise_for_status()
        return response.json()


# ===============================================================================================================================================
# GATE REAL-TIME API HELPERS

async def _realtime_get(path: str, params: dict | None = None) -> dict | list:
    """Generic GET against the Gate Building real-time API."""
    cfg = get_realtime_api_config()
    if not cfg["api_key"]:
        return {"error": "GATE_REALTIME_API_KEY is not configured in .env"}
    headers = {"X-API-Key": cfg["api_key"]}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{cfg['base_url']}{path}", headers=headers, params=params or {})
        response.raise_for_status()
        return response.json()


REALTIME_METERS = {
    "BuildingMain", "OVK", "3D_LED", "AC_Elevator",
    "OutsideLighting_1", "OutsideLighting_2",
    "VehicleCharging_1", "VehicleCharging_2",
    "AirConditioner_1", "AirConditioner_2",
    "Circuit_7", "Circuit_8", "Circuit_9", "Circuit_10",
    "Circuit_11", "Circuit_12", "Boiler_Circuit_6",
}

REALTIME_SOLAR_PARAMS = {"PpvInput", "Battery_P", "SOC", "Temperature1", "PmeterTotal", "Pload"}


# ===============================================================================================================================================
# GATE FORECAST DB HELPERS

async def _forecast_query(query: str, params: list | None = None) -> list[dict]:
    """Run a read-only query against the Gate forecast PostgreSQL database."""
    cfg = get_forecast_db_config()
    if not cfg["password"]:
        return [{"error": "FORECAST_DB_PASSWORD is not configured in .env"}]
    conn = await asyncpg.connect(
        host=cfg["host"],
        port=cfg["port"],
        database=cfg["database"],
        user=cfg["user"],
        password=cfg["password"],
        timeout=15,
    )
    try:
        rows = await conn.fetch(query, *(params or []))
        return [dict(r) for r in rows]
    finally:
        await conn.close()


# ===============================================================================================================================================
# MCP TOOLS  SUPABASE (published forecast tables for QA / external sharing)

@mcp.tool()
async def supabase_list_tables() -> str:
    """
    List available tables in Supabase (the published / QA sharing layer).

    These tables contain curated forecast data published for controlled external access.
    Tables: forecast_global, forecast_long_term, forecast_short_term,
            unified_global_long_term, unified_global_short_term,
            unified_local_long_term, unified_local_short_term
    """
    data = await _supabase_openapi()
    if isinstance(data, dict) and "error" in data:
        return data["error"]
    if "paths" not in data:
        return "Unexpected response format."
    items = []
    for path in data["paths"].keys():
        if path != "/" and isinstance(path, str) and path.startswith("/"):
            items.append(path.strip("/").split("?")[0])
    return "\n".join(sorted(set(items)))


@mcp.tool()
async def supabase_get_rows(table: str, limit: int = 20, order_by: str | None = None) -> str:
    """
    Fetch rows from a Supabase table (published forecast data).

    table: one of the Supabase table names
    limit: max rows (default 20, max 100)
    order_by: column name, optionally with .asc or .desc suffix (e.g. 'forecast_timestamp.desc')
    """
    if not validate_table_name(table):
        return "Invalid table name"
    limit = normalize_limit(limit)
    params: dict = {"limit": str(limit)}
    if order_by:
        order = str(order_by).strip()
        if not order.endswith(".asc") and not order.endswith(".desc"):
            order = f"{order}.desc"
        params["order"] = order

    rows = await _supabase_get(table, params)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "error" in rows[0]:
        return f"Error: {rows[0]['error']}"
    return json.dumps(rows, indent=2, default=str)


@mcp.tool()
async def supabase_table_info(table: str) -> str:
    """
    Get the column names for a Supabase table by fetching 1 row.
    """
    if not validate_table_name(table):
        return "Invalid table name"
    rows = await _supabase_get(table, {"limit": "1"})
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        if "error" in rows[0]:
            return f"Error: {rows[0]['error']}"
        return f"Table '{table}' columns: {', '.join(rows[0].keys())}"
    return f"Table '{table}' is empty or not found."


@mcp.tool()
async def supabase_count_rows(table: str) -> str:
    """
    Count total rows in a Supabase table.
    """
    if not validate_table_name(table):
        return "Invalid table name"
    cfg = get_supabase_config()
    if not cfg["key"]:
        return "SUPABASE_SECRET_KEY is not configured"
    headers = get_supabase_headers()
    headers["Prefer"] = "count=exact"
    headers["Range"] = "0-0"
    url = f"{cfg['url']}/rest/v1/{table}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers, params={"select": "*"})
        response.raise_for_status()
    cr = response.headers.get("content-range", "")
    m = re.search(r"/(\d+)", cr)
    return m.group(1) if m else "count unavailable"


@mcp.tool()
async def supabase_query(
    table: str,
    select: str = "*",
    filters: str | None = None,
    order_by: str | None = None,
    limit: int = 20,
) -> str:
    """
    Advanced query on a Supabase table with PostgREST-style filtering.

    table: Supabase table name
    select: columns to return, e.g. 'circuit_id,forecast_timestamp,forecast_value'
    filters: PostgREST filter string, e.g. 'circuit_id=eq.BuildingMain'
             Multiple filters separated by '&', e.g. 'circuit_id=eq.BuildingMain&step_ahead=eq.1'
    order_by: column.direction, e.g. 'forecast_timestamp.desc'
    limit: max rows (default 20)
    """
    if not validate_table_name(table):
        return "Invalid table name"
    limit = normalize_limit(limit)
    params: dict = {"select": select, "limit": str(limit)}
    if order_by:
        order = str(order_by).strip()
        if not order.endswith(".asc") and not order.endswith(".desc"):
            order = f"{order}.desc"
        params["order"] = order
    if filters:
        for part in filters.split("&"):
            if "=" in part:
                k, v = part.split("=", 1)
                params[k.strip()] = v.strip()

    rows = await _supabase_get(table, params)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "error" in rows[0]:
        return f"Error: {rows[0]['error']}"
    return json.dumps(rows, indent=2, default=str)



@mcp.tool()
async def realtime_sensor_meta() -> str:
    """
    Get metadata for all floors, rooms, and sensors from the Gate Building real-time API.
    Returns which rooms exist on each floor and which sensor IDs / parameters are available.
    """
    data = await _realtime_get("/sensor/data/meta")
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def realtime_sensor_data(
    floor: int,
    room: str | None = None,
    parameter: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> str:
    """
    Get live / recent sensor readings from the Gate Building real-time API.
    Data is updated every 15 minutes.

    floor: 0-3
    room: optional room name (e.g. 'kitchen', 'hall_sap', 'cabinet_1', 'director')
    parameter: optional â€” 'CO2', 'Humidity', or 'Temp'
    start_date / end_date: optional, format 'YYYY-MM-DD HH:MM:SS' (Sofia local time)

    Floor 0 rooms: conference_room, kitchen, lobby
    Floor 1 rooms: hall_sap, meeting_room, training_lab, visualisation
    Floor 2 rooms: cabinet_1, cabinet_3, cabinet_5-9, discussion_room, recreation_hall,
                   research_leader_1-4, researchers, waiting_area
    Floor 3 rooms: assist_director_2, assist_director_3, assistant, business, director,
                   host, hr, it_department, lawyer, meeting, office_1, waiting_area
    """
    if floor not in (0, 1, 2, 3):
        return "Error: floor must be 0, 1, 2, or 3"
    params: dict = {}
    if room:
        params["room"] = room
    if parameter:
        params["parameters"] = parameter
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    data = await _realtime_get(f"/sensor/data/floor_{floor}/", params)
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def realtime_electricity_meta() -> str:
    """
    Get metadata for all electricity meters from the Gate Building real-time API.
    Returns meter names, point IDs, descriptions, and units.
    """
    data = await _realtime_get("/electricity/meta")
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def realtime_electricity_data(
    meter: str,
    meter_type: str = "Energy",
    start_date: str | None = None,
    end_date: str | None = None,
) -> str:
    """
    Get live electricity meter readings from the Gate Building real-time API.
    Data is updated every 1 hour.

    meter: one of BuildingMain, OVK, 3D_LED, AC_Elevator, OutsideLighting_1,
           OutsideLighting_2, VehicleCharging_1, VehicleCharging_2,
           AirConditioner_1, AirConditioner_2, Circuit_7 .. Circuit_12, Boiler_Circuit_6
    meter_type: 'Energy' (kWh) or 'Power' (W)
    start_date / end_date: optional, format 'YYYY-MM-DD HH:MM:SS' (Sofia local time)
    """
    if meter not in REALTIME_METERS:
        return f"Error: unknown meter '{meter}'. Valid: {', '.join(sorted(REALTIME_METERS))}"
    if meter_type not in ("Energy", "Power"):
        return "Error: meter_type must be 'Energy' or 'Power'"
    params: dict = {"meter": meter, "meter_type": meter_type}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    data = await _realtime_get("/electricity/data", params)
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def realtime_solar_meta() -> str:
    """
    Get metadata for solar panel parameters from the Gate Building real-time API.
    """
    data = await _realtime_get("/solar/meta")
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def realtime_solar_data(
    parameter: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> str:
    """
    Get solar panel data from the Gate Building real-time API.
    Data is updated every 1 hour.

    parameter: one of PpvInput, Battery_P, SOC, Temperature1, PmeterTotal, Pload
    start_date / end_date: optional, format 'YYYY-MM-DD HH:MM:SS' (Sofia local time)
    """
    if parameter not in REALTIME_SOLAR_PARAMS:
        return f"Error: unknown parameter '{parameter}'. Valid: {', '.join(sorted(REALTIME_SOLAR_PARAMS))}"
    params: dict = {"parameter": parameter}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    data = await _realtime_get("/solar/data", params)
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def forecast_list_tables() -> str:
    """
    List all tables in the Gate forecast database.
    Requires GATE network / VPN connectivity.
    """
    try:
        rows = await _forecast_query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        )
        if rows and isinstance(rows[0], dict) and "error" in rows[0]:
            return rows[0]["error"]
        return "\n".join(r["table_name"] for r in rows) if rows else "No tables found."
    except Exception as exc:
        return f"Error connecting to forecast DB: {exc}"


@mcp.tool()
async def forecast_table_info(table: str) -> str:
    """
    Get column names and types for a forecast table.
    """
    if not validate_table_name(table):
        return "Invalid table name"
    try:
        rows = await _forecast_query(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
            [table],
        )
        if not rows:
            return f"Table '{table}' not found in forecast database."
        if isinstance(rows[0], dict) and "error" in rows[0]:
            return rows[0]["error"]
        lines = [f"{r['column_name']} ({r['data_type']})" for r in rows]
        return f"Columns in forecast.{table}:\n" + "\n".join(lines)
    except Exception as exc:
        return f"Error: {exc}"


# Mapping from user-friendly circuit names to forecast DB identifiers
FORECAST_CIRCUIT_ALIASES = {
    "elevator": "tac_elevator", "lift": "tac_elevator", "ac_elevator": "tac_elevator",
    "tac_elevator": "tac_elevator",
    "main": "tmain", "buildingmain": "tmain", "building_main": "tmain", "tmain": "tmain",
    "ovk": "tovk", "tovk": "tovk",
    "3d_led": "t3d_led", "3dled": "t3d_led", "led": "t3d_led", "t3d_led": "t3d_led", "3d led": "t3d_led",
    "boiler": "tboiler_circuit_6", "circuit_6": "tboiler_circuit_6", "tboiler_circuit_6": "tboiler_circuit_6",
    "airconditioner_1": "tairconditioner_1", "ac1": "tairconditioner_1", "tairconditioner_1": "tairconditioner_1",
    "airconditioner_2": "tairconditioner_2", "ac2": "tairconditioner_2", "tairconditioner_2": "tairconditioner_2",
    "c7": "circuit_7", "circuit7": "circuit_7", "circuit 7": "circuit_7", "circuit_7": "circuit_7",
    "c8": "circuit_8", "circuit8": "circuit_8", "circuit 8": "circuit_8", "circuit_8": "circuit_8",
    "c9": "circuit_9", "circuit9": "circuit_9", "circuit 9": "circuit_9", "circuit_9": "circuit_9",
    "c10": "circuit_10", "circuit10": "circuit_10", "circuit 10": "circuit_10", "circuit_10": "circuit_10",
    "c11": "circuit_11", "circuit11": "circuit_11", "circuit 11": "circuit_11", "circuit_11": "circuit_11",
    "c12": "circuit_12", "circuit12": "circuit_12", "circuit 12": "circuit_12", "circuit_12": "circuit_12",
}


async def _detect_circuit_column(table: str) -> str | None:
    """Detect whether a forecast table uses 'meter' or 'circuit_id' column."""
    try:
        rows = await _forecast_query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = $1 "
            "AND column_name IN ('meter', 'circuit_id') ORDER BY ordinal_position",
            [table],
        )
        if rows:
            return rows[0]["column_name"]
    except Exception:
        pass
    return None


@mcp.tool()
async def forecast_list_circuits(table: str, limit: int = 200) -> str:
    """
    List distinct circuit or meter identifiers represented in a forecast table.

    table: forecast table name
    limit: maximum distinct values to return (default 200)

    Useful when the user asks which circuits/meters are available before filtering.
    Requires GATE network / VPN.
    """
    if not validate_table_name(table):
        return "Invalid table name"

    limit = max(1, min(int(limit), 500))

    try:
        col = await _detect_circuit_column(table)
        if not col:
            return json.dumps(
                {
                    "table": table,
                    "column": None,
                    "count": 0,
                    "circuits": [],
                    "message": "No 'meter' or 'circuit_id' column was found in this table.",
                },
                indent=2,
            )

        query = (
            f"SELECT DISTINCT {col} AS circuit "
            f"FROM {table} "
            f"WHERE {col} IS NOT NULL "
            f"ORDER BY {col} "
            f"LIMIT {limit}"
        )
        rows = await _forecast_query(query)
        if rows and isinstance(rows[0], dict) and "error" in rows[0]:
            return rows[0]["error"]

        circuits = [row["circuit"] for row in rows if isinstance(row, dict) and row.get("circuit") is not None]
        return json.dumps(
            {
                "table": table,
                "column": col,
                "count": len(circuits),
                "circuits": circuits,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:
        return f"Error: {exc}"


@mcp.tool()
async def forecast_get_data(
    table: str,
    limit: int = 50,
    order_by: str | None = None,
    circuit: str | None = None,
) -> str:
    """
    Fetch rows from a Gate forecast table.

    table: forecast table name (e.g. 'unified_local_long_term', 'forecasts_long', 'shortterm_electricity_forecasts')
    limit: max rows (default 50, max 500)
    order_by: column to sort by (appends DESC), e.g. 'forecast_timestamp'
    circuit: circuit/meter filter — accepts friendly names like 'elevator', 'main', 'ovk', 'ac1', etc.
             Auto-resolves to the DB identifier (e.g. 'tac_elevator', 'tmain').

    Requires GATE network / VPN.
    """
    if not validate_table_name(table):
        return "Invalid table name"
    limit = max(1, min(int(limit), 500))

    clauses = []
    params: list = []
    if circuit:
        resolved = FORECAST_CIRCUIT_ALIASES.get(circuit.lower().strip(), circuit)
        col = await _detect_circuit_column(table)
        if col:
            params.append(resolved)
            clauses.append(f"{col} = ${len(params)}")

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    order = ""
    if order_by and re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", order_by):
        order = f" ORDER BY {order_by} DESC"

    query = f"SELECT * FROM {table}{where}{order} LIMIT {limit}"

    try:
        rows = await _forecast_query(query, params if params else None)
        if rows and isinstance(rows[0], dict) and "error" in rows[0]:
            return rows[0]["error"]
        for row in rows:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return json.dumps({"table": table, "count": len(rows), "rows": rows}, indent=2, default=str)
    except Exception as exc:
        return f"Error: {exc}"


@mcp.tool()
async def forecast_latest(table: str, limit: int = 10, circuit: str | None = None) -> str:
    """
    Fetch the most recent forecast rows from a table (auto-detects timestamp column).

    table: forecast table name
    limit: max rows (default 10)
    circuit: circuit/meter filter — accepts friendly names like 'elevator', 'main', etc.
    """
    if not validate_table_name(table):
        return "Invalid table name"
    limit = max(1, min(int(limit), 200))

    try:
        cols = await _forecast_query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = $1 "
            "AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date') "
            "ORDER BY ordinal_position LIMIT 1",
            [table],
        )
        ts_col = cols[0]["column_name"] if cols else None

        clauses = []
        params: list = []
        if circuit:
            resolved = FORECAST_CIRCUIT_ALIASES.get(circuit.lower().strip(), circuit)
            col = await _detect_circuit_column(table)
            if col:
                params.append(resolved)
                clauses.append(f"{col} = ${len(params)}")

        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        order = f" ORDER BY {ts_col} DESC" if ts_col else ""
        query = f"SELECT * FROM {table}{where}{order} LIMIT {limit}"

        rows = await _forecast_query(query, params if params else None)
        if rows and isinstance(rows[0], dict) and "error" in rows[0]:
            return rows[0]["error"]
        for row in rows:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return json.dumps({"table": table, "count": len(rows), "rows": rows}, indent=2, default=str)
    except Exception as exc:
        return f"Error: {exc}"


# ===============================================================================================================================================
# NATURAL LANGUAGE ROUTING HELPERS

def detect_limit(text: str, default: int = 10) -> int:
    match = re.search(r"\b(?:top|last|latest|recent|first|limit)?\s*(\d{1,4})\b", text.lower())
    if match:
        return normalize_limit(int(match.group(1)))
    return default


def parse_legacy_tool_call(user_input: str):
    """Backward-compatible exact tool call parsing: tool_name {json_args}"""
    parts = user_input.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    tool_name, json_args = parts
    if tool_name not in mcp.tools:
        return None
    try:
        args = json.loads(json_args)
    except json.JSONDecodeError:
        return None
    return tool_name, args


# ===============================================================================================================================================
# MCP PROMPT

@mcp.prompt()
async def building_prompt(request: MCPRequest) -> dict:
    """
    You are a data assistant for the GATE Building with three data sources:

SOURCE 1: SUPABASE (published forecast tables — QA / sharing layer)
Curated forecast data published for controlled external access via Supabase REST API.

Tables:
- forecast_global, forecast_long_term, forecast_short_term
- unified_global_long_term, unified_global_short_term
- unified_local_long_term, unified_local_short_term

Tools: supabase_list_tables, supabase_get_rows, supabase_table_info,
       supabase_count_rows, supabase_query

SOURCE 2: GATE REAL-TIME BUILDING API (live data)
For current / live sensor and electricity readings (updated every 15 min / 1 hour).

Sensor data by floor (floors 0-3):
- Floor 0: conference_room, kitchen, lobby
- Floor 1: hall_sap, meeting_room, training_lab, visualisation
- Floor 2: cabinets, discussion_room, recreation_hall, research_leaders, researchers, waiting_area
- Floor 3: director, business, hr, it_department, lawyer, meeting, office_1, etc.
- Parameters: CO2, Humidity, Temp

Electricity meters:
- BuildingMain, OVK, 3D_LED, AC_Elevator, Boiler_Circuit_6
- Circuit_7..Circuit_12, AirConditioner_1, AirConditioner_2
- OutsideLighting_1, OutsideLighting_2, VehicleCharging_1, VehicleCharging_2
- Types: Energy (kWh), Power (W)

Solar: PpvInput, Battery_P, SOC, Temperature1, PmeterTotal, Pload

Tools: realtime_sensor_data, realtime_sensor_meta, realtime_electricity_data,
       realtime_electricity_meta, realtime_solar_data, realtime_solar_meta

SOURCE 3: GATE FORECAST DATABASE (internal forecast DB)
PostgreSQL database with full forecast/prediction data for circuits.
Requires GATE network (building Wi-Fi or VPN).

Tools: forecast_list_tables, forecast_table_info, forecast_get_data, forecast_latest

ROUTING RULES:
- "real-time", "live", "current", "now", "temperature", "CO2", "humidity", "sensor" → realtime_*
- "forecast", "prediction", "predicted", "future" → forecast_* or supabase_*
- "supabase", "published", "shared", "QA" → supabase_*
- circuits/electricity/energy/power/meter → realtime_electricity_data (live) or forecast (predicted)
- rooms/temperature/humidity/CO2 → realtime_sensor_data
- solar/PV/battery → realtime_solar_data
- Default to real-time tools for current building state.
- Use Supabase for the published/curated forecast data accessible to external users.
- Use forecast DB for internal/full forecast analysis.

Examples:
- "current kitchen temperature" → realtime_sensor_data(floor=0, room="kitchen", parameter="Temp")
- "live power for main meter" → realtime_electricity_data(meter="BuildingMain", meter_type="Power")
- "show published forecasts" → supabase_list_tables()
- "latest BuildingMain forecasts" → supabase_query(table="unified_local_short_term",
    filters="circuit_id=eq.BuildingMain", order_by="forecast_timestamp.desc")
- "forecast tables in DB" → forecast_list_tables()
- "solar battery status" → realtime_solar_data(parameter="SOC")
    """
    user_input = request.input.get("user_input", "")
    if not isinstance(user_input, str) or not user_input.strip():
        return MCPResponse(output={"error": "user_input must be a non-empty string"})

    text = user_input.strip()
    lowered = text.lower()

    # Backward-compatible exact tool call parsing
    legacy = parse_legacy_tool_call(text)
    if legacy:
        tool_name, args = legacy
        tool_func = mcp.tools.get(tool_name)
        try:
            result = await tool_func(**args)
            return MCPResponse(output={"result": result})
        except Exception as exc:
            return MCPResponse(output={"error": str(exc)})

    # Natural-language routing
    limit = detect_limit(lowered)

    # Supabase table listing
    if any(term in lowered for term in ("list tables", "show tables", "available tables", "supabase tables")):
        result = await supabase_list_tables()
        return MCPResponse(output={"result": result})

    # Supabase table match
    supabase_table_match = None
    for t in sorted(SUPABASE_TABLES, key=len, reverse=True):
        if t in lowered:
            supabase_table_match = t
            break

    if supabase_table_match:
        result = await supabase_get_rows(table=supabase_table_match, limit=limit,
                                         order_by="forecast_timestamp.desc")
        return MCPResponse(output={"result": result})

    # Forecast DB
    if any(word in lowered for word in ("forecast db", "forecast database", "internal forecast")):
        result = await forecast_list_tables()
        return MCPResponse(output={"result": result})

    # Real-time sensor (room-based)
    room_floor_map = {
        "conference_room": 0, "kitchen": 0, "lobby": 0, "conference": 0,
        "hall_sap": 1, "meeting_room": 1, "training_lab": 1, "visualisation": 1, "meeting": 1,
        "cabinet_1": 2, "cabinet_3": 2, "discussion_room": 2, "recreation_hall": 2,
        "researchers": 2, "research_leader_1": 2, "waiting_area": 2,
        "director": 3, "business": 3, "hr": 3, "it_department": 3,
        "lawyer": 3, "office_1": 3, "assistant": 3, "host": 3,
    }
    detected_room = None
    detected_floor = None
    for room_name, floor_num in sorted(room_floor_map.items(), key=lambda x: len(x[0]), reverse=True):
        if room_name in lowered:
            detected_room = room_name
            detected_floor = floor_num
            break

    if detected_room is not None:
        param = None
        if "temperature" in lowered or re.search(r"\btemp\b", lowered):
            param = "Temp"
        elif "humidity" in lowered:
            param = "Humidity"
        elif "co2" in lowered or "coâ‚‚" in lowered:
            param = "CO2"
        result = await realtime_sensor_data(floor=detected_floor, room=detected_room, parameter=param)
        return MCPResponse(output={"result": result})

    # Real-time electricity
    meter_aliases = {
        "main": "BuildingMain", "building main": "BuildingMain", "buildingmain": "BuildingMain",
        "ovk": "OVK", "3d led": "3D_LED", "led": "3D_LED",
        "elevator": "AC_Elevator", "lift": "AC_Elevator", "ac_elevator": "AC_Elevator",
        "boiler": "Boiler_Circuit_6", "circuit 6": "Boiler_Circuit_6",
        "circuit_7": "Circuit_7", "circuit 7": "Circuit_7",
        "circuit_8": "Circuit_8", "circuit 8": "Circuit_8",
        "circuit_9": "Circuit_9", "circuit 9": "Circuit_9",
        "circuit_10": "Circuit_10", "circuit 10": "Circuit_10", "circuit10": "Circuit_10",
        "circuit_11": "Circuit_11", "circuit 11": "Circuit_11", "circuit11": "Circuit_11",
        "circuit_12": "Circuit_12", "circuit 12": "Circuit_12", "circuit12": "Circuit_12",
        "airconditioner_1": "AirConditioner_1", "ac1": "AirConditioner_1", "ac 1": "AirConditioner_1",
        "airconditioner_2": "AirConditioner_2", "ac2": "AirConditioner_2", "ac 2": "AirConditioner_2",
        "outsidelighting_1": "OutsideLighting_1", "outside light 1": "OutsideLighting_1",
        "outsidelighting_2": "OutsideLighting_2", "outside light 2": "OutsideLighting_2",
        "vehiclecharging_1": "VehicleCharging_1", "ev1": "VehicleCharging_1", "ev 1": "VehicleCharging_1",
        "vehiclecharging_2": "VehicleCharging_2", "ev2": "VehicleCharging_2", "ev 2": "VehicleCharging_2",
    }
    detected_meter = None
    for alias, meter in sorted(meter_aliases.items(), key=lambda x: len(x[0]), reverse=True):
        if alias in lowered:
            detected_meter = meter
            break

    if detected_meter:
        meter_type = "Power" if "power" in lowered or "watt" in lowered else "Energy"
        result = await realtime_electricity_data(meter=detected_meter, meter_type=meter_type)
        return MCPResponse(output={"result": result})

    # Solar
    if any(word in lowered for word in ("solar", "pv", "battery", "soc", "photovoltaic")):
        param = "SOC"
        for sp in REALTIME_SOLAR_PARAMS:
            if sp.lower() in lowered:
                param = sp
                break
        result = await realtime_solar_data(parameter=param)
        return MCPResponse(output={"result": result})

    # Vague requests â€” provide helpful meta
    if any(word in lowered for word in ("electricity", "energy", "power", "circuit", "meter")):
        result = await realtime_electricity_meta()
        return MCPResponse(output={"result": result})

    if any(word in lowered for word in ("room", "temperature", "humidity", "co2", "sensor", "environment")):
        result = await realtime_sensor_meta()
        return MCPResponse(output={"result": result})

    if any(word in lowered for word in ("forecast", "prediction", "predicted")):
        result = await supabase_list_tables()
        return MCPResponse(output={"result": result})

    return MCPResponse(
        output={
            "error": (
                "I could not understand the request. Try examples like:\n"
                "- 'current kitchen temperature'\n"
                "- 'live power for building main'\n"
                "- 'show published forecast tables'\n"
                "- 'solar battery status'\n"
                "- 'forecast tables in DB'"
            )
        }
    )


if __name__ == "__main__":
    load_local_env_file()

    parser = argparse.ArgumentParser(description="GATE Building MCP Server")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8091")))
    args = parser.parse_args()

    mcp.settings.host = args.host
    mcp.settings.port = args.port
    log(f"MCP HTTP running {args.host}:{args.port} (path: /mcp)")
    mcp.run(transport="streamable-http")
