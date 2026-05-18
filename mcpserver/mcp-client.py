# usinglangchain 

import argparse
import asyncio
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
# Import URL parser to inspect request paths like /chat or /health.
from urllib.parse import urlparse

import httpx
from langgraph.prebuilt import create_react_agent

from langchain_mcp_adapters.client import MultiServerMCPClient

# OpenAI chat model wrapper
from langchain_openai import ChatOpenAI

from shared import (
    build_internal_service_url,
    get_cors_allowed_origins,
    format_exception,
    get_openai_config,
    load_institute_context,
    load_local_env_file,
    log,    
)

# ======================================================================================
# MCP server URLs
# Functions that return Postgrest MCP server URL

def get_building_mcp_url() -> str:
    return build_internal_service_url(
        "MCP_URL",
        "MCP_HOSTPORT",
        "http://127.0.0.1:8091/mcp",
    )


# Function that returns the Cesium MCP server URL.
# Also configurable through environment variables.
def get_cesium_mcp_url() -> str:
    return build_internal_service_url(
        "CESIUM_MCP_URL",
        "CESIUM_MCP_HOSTPORT",
        "http://127.0.0.1:8092/mcp",
    )


async def probe_mcp_url(name: str, url: str) -> dict:
    """
    Lightweight connectivity probe for an MCP HTTP endpoint.
    """
    result = {"name": name, "url": url}
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
        result["ok"] = 200 <= response.status_code < 500
        result["status_code"] = response.status_code
        result["content_type"] = response.headers.get("content-type", "")
        result["body_preview"] = response.text[:200]
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
    return result


async def run_mcp_checks() -> list[dict]:
    return await asyncio.gather(
        probe_mcp_url("building", get_building_mcp_url()),
        probe_mcp_url("cesium", get_cesium_mcp_url()),
    )


async def debug_load_mcp_tools() -> dict:
    client = MultiServerMCPClient(
        {
            "building": {
                "transport": "streamable_http",
                "url": get_building_mcp_url(),
            },
            "cesium": {
                "transport": "streamable_http",
                "url": get_cesium_mcp_url(),
            },
        }
    )
    tools = await client.get_tools()
    return {
        "building_mcp_url": get_building_mcp_url(),
        "cesium_mcp_url": get_cesium_mcp_url(),
        "tool_count": len(tools),
        "tool_names": [getattr(tool, "name", str(tool)) for tool in tools],
    }


# ======================================================================================
# LANGCHAIN AGENT BOOTSTRAPPING
# gLOBAL VARIABLE to cache agent instance across requests
_AGENT = None
# Lock to prevent race conditions when initializing the agent in concurrent requests.. This means that if multiple requests come in at the same time when the agent is not initialized, only one of them will initialize the agent while the others will wait for it to finish. This prevents multiple instances of the agent from being created and ensures thread safety.
_AGENT_LOCK = asyncio.Lock()

# ── Persistent event loop ──────────────────────────────────────────────────────
# A single event loop runs forever in a background daemon thread.
# All HTTP handler threads submit coroutines here via run_coroutine_threadsafe(),
# so the cached agent and its MCP client connections are always bound to the
# same live loop — eliminating the "task attached to a different loop" crash.
_BG_LOOP: asyncio.AbstractEventLoop = asyncio.new_event_loop()
threading.Thread(target=_BG_LOOP.run_forever, daemon=True, name="bg-loop").start()


def _run(coro):
    """Submit a coroutine to the persistent loop and block until it finishes."""
    future = asyncio.run_coroutine_threadsafe(coro, _BG_LOOP)
    return future.result(timeout=120)


# Construct systemprompt and analyse agent behavior

def build_system_prompt() -> str:
    institute_context = load_institute_context()
    # Load optional context describing the institute/building.
    institute_context = load_institute_context() or ""

    # Return the full prompt string.
    return f"""
You are a building and institute assistant for the GATE Institute.

You have access to tools from two MCP servers:
- building: live sensor data, electricity meters, solar panels, and forecast data
- cesium: 3D building navigation tools

Core rules:
- Always use tools for factual questions about building data, telemetry, tables, rows, counts, latest values, and navigation.
- For navigation requests such as zooming to a room, floor, circuit, or the whole building, prefer cesium tools.
- For live/current sensor data (temperature, humidity, CO2), use realtime_sensor_data with the correct floor and room.
- For live electricity/power readings, use realtime_electricity_data with the correct meter name.
- For solar panel status, use realtime_solar_data.
- For published forecast data, use supabase_* tools (supabase_list_tables, supabase_get_rows, supabase_query).
  Supabase currently only has: 3d_led and global forecasts (not all circuits).
- For per-circuit forecasts (elevator, main, OVK, AC, boiler, etc.), ALWAYS use forecast_* tools (forecast_list_circuits, forecast_get_data, forecast_latest) which query the internal forecast DB.
  The forecast DB has forecasts for ALL circuits. Use friendly names like 'elevator', 'main', 'ovk', 'ac1', 'boiler', etc.
  Example: forecast_get_data(table='unified_local_long_term', circuit='elevator', order_by='forecast_timestamp', limit=24)
- If the user asks which circuits/meters exist in a forecast table, use forecast_list_circuits first instead of guessing.
- For elevator, lift, HVAC, AC queries about LIVE data, use realtime_electricity_data with meter='AC_Elevator'.
  For elevator FORECAST/prediction data, use forecast_get_data or forecast_latest with circuit='elevator'.
- For usage questions, first discover available data with meta tools, then fetch specific data.
- If the request needs more than one tool call, continue until you have enough evidence.
- Base answers on tool output, not assumptions.
- Keep responses concise, concrete, and helpful.
- When a tool returns structured JSON, use it faithfully.
- Do not claim data is unavailable unless at least one relevant tool call was attempted and returned no usable data.
- If a navigation tool returns a Cesium command, explain the action clearly to the user.

STRICT NO-FABRICATION RULES — these override everything else:
- NEVER invent, estimate, or guess sensor readings, energy values, timestamps, room names, circuit IDs, or any building data. Every number you state must come directly from a tool result.
- If a tool returns empty results or no matching rows, say exactly that: "No data was found for [topic]." Do not fill in plausible-sounding values.
- If a tool call fails or a table does not exist, tell the user plainly. Do not substitute remembered or hallucinated values.
- Do not extrapolate trends, averages, or forecasts unless the tool result explicitly contains enough rows for you to compute them — and if you do compute them, show the source values.
- Do not say things like "typically", "usually", "roughly", or "approximately" when referring to live building data. Use only what the tools returned.
- If you are unsure which table or circuit to query, ask the user to clarify rather than guessing and querying the wrong one.

Institute context:
{institute_context}
""".strip() 


# Build langchain agent and cache it

async def build_agent():
    global _AGENT

    # If the agent is already built, return it.
    if _AGENT is not None:
        return _AGENT

    # Otherwise, acquire the lock to build the agent.
    async with _AGENT_LOCK:
        # Double check if the agent was built while waiting for the lock.
        if _AGENT is not None:
            return _AGENT

        log("Building agent...")

        # Load OpenAI config from environment variables and build the chat model.
        cfg = get_openai_config()

        if not cfg["api_key"]:
            if not cfg["api_key"]:
                raise RuntimeError("Missing OPENAI_API_KEY in environment (.env).")

       # Create an MCP client that connects to multiple MCP servers.
        client = MultiServerMCPClient(
            {
                "building": {
                    "transport": "streamable_http",
                    "url": get_building_mcp_url(),
                },
                "cesium": {
                    "transport": "streamable_http",
                    "url": get_cesium_mcp_url(),
                },
            }
        )

        # Fetch the tools exposed by both MCP servers
        tools = await client.get_tools()

        #  Log how many tools were discovered.
        log(f"[chat] loaded {len(tools)} MCP tools from building + cesium")

        # Create OpenAI model wrapper used by langchain

        model = ChatOpenAI(
            model = cfg["model"],
            api_key = cfg["api_key"],
            base_url = cfg["base_url"],
            temperature = 0.2,
        )

        # Create the agent using langgraph's react agent
        _AGENT = create_react_agent(model, tools)
        log("Agent built successfully.")
        return _AGENT


# ====================================================================================== 
# MESSAGE normalization
def normalize_history(history: list | None) -> list[dict]:
    normalized = []

    if not isinstance(history, list):
        return normalized
    
    # iterate through every item in history
    for item in history:
        if not isinstance(item, dict):
            continue
        # normalise the role field
        role = item.get("role", "").strip().lower()
        content = item.get("content", "")

        if role not in {"user", "assistant", "system"}:
            continue

        if not isinstance(content, str):
            content = str(content)
           
        content = content.strip()

        if content:
            normalized.append({"role": role, "content": content})
    return normalized


# Safely parse json
def _maybe_parse_json_text(text: str):

    # Attempt to parse JSON.
    try:
        return json.loads(text)

    # If parsing fails, return None.
    except Exception:
        return None


def _extract_cesium_command_from_dict(payload: dict) -> dict | None:
    if not isinstance(payload, dict):
        return None

    # Legacy/wrapped format.
    if isinstance(payload.get("cesiumCommand"), dict):
        return payload["cesiumCommand"]

    # Direct tool result format returned by cesium MCP tools.
    if payload.get("type") == "cesium" and isinstance(payload.get("action"), str):
        return payload

    return None
    
def extract_cesium_command_from_agent_messages(messages) -> dict | None:

    # Ensure messages are a list.
    if not isinstance(messages, list):
        return None

    # Iterate through each message.
    for msg in messages:

        # Extract content field.
        content = getattr(msg, "content", None)

        # Case 1: content is plain text.
        if isinstance(content, str):

            # Attempt to parse JSON.
            parsed = _maybe_parse_json_text(content)

            cmd = _extract_cesium_command_from_dict(parsed) if isinstance(parsed, dict) else None
            if cmd:
                return cmd

        # Case 2: content is structured list (common in tool responses).
        elif isinstance(content, list):

            # Iterate through each item.
            for item in content:

                # Ensure item is a dictionary.
                if isinstance(item, dict):

                    # Some adapters already provide structured JSON dict blocks.
                    direct_cmd = _extract_cesium_command_from_dict(item)
                    if direct_cmd:
                        return direct_cmd

                    # Check typical fields where text might appear.
                    for key in ("text", "content"):

                        value = item.get(key)

                        # If value is text, attempt JSON parsing.
                        if isinstance(value, str):

                            parsed = _maybe_parse_json_text(value)

                            cmd = _extract_cesium_command_from_dict(parsed) if isinstance(parsed, dict) else None
                            if cmd:
                                return cmd

    # If nothing found return None.
    return None


#  Function that extracts the final assistant text from the agent result. This is the text that will be sent back to the frontend as the assistant's response. It looks for the last message from the assistant in the agent's message history and returns its content as a string. If no assistant message is found, it returns an empty string.

def extract_reply_text(result: dict) -> str:

    # Extract message list.
    messages = result.get("messages")

    # Validate structure.
    if not isinstance(messages, list) or not messages:
        return "No response."

    # Get the final message.
    last = messages[-1]

    # Extract content.
    content = getattr(last, "content", None)

    # If content is a string return it.
    if isinstance(content, str) and content.strip():
        return content.strip()

    # If content is structured list.
    if isinstance(content, list):

        parts = []

        # Extract all text segments.
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())

        # Join them into final message.
        if parts:
            return "\n".join(parts)

    # Fallback: convert entire message to string.
    text = str(last).strip()

    return text or "No response."


# ======================================================================================
# MAIN CHAT HANDLER

def _normalize_client_command(client_command) -> dict | None:
    if not isinstance(client_command, dict):
        return None
    if client_command.get("type") != "cesium":
        return None
    action = client_command.get("action")
    if not isinstance(action, str) or not action.strip():
        return None
    return client_command


def summarize_chat_error(detail: str) -> tuple[str, str]:
    lowered = detail.lower()
    compact = " ".join(detail.split())
    short_detail = compact[:500]

    if "api_key" in lowered or "authentication" in lowered or "unauthorized" in lowered:
        return (
            "OpenAI authentication failed. Check OPENAI_API_KEY and model access.",
            short_detail,
        )

    if "not acceptable" in lowered and "text/event-stream" in lowered:
        return (
            "The MCP service rejected the request headers. The streamable HTTP handshake is failing.",
            short_detail,
        )

    if "invalid host header" in lowered:
        return (
            "The MCP service rejected the internal host header. Internal host allowlisting is still misconfigured.",
            short_detail,
        )

    if "timeout" in lowered:
        return (
            "A backend request timed out while the assistant was processing your message.",
            short_detail,
        )

    if "connection" in lowered or "connect" in lowered or "mcp" in lowered:
        return (
            "The assistant hit an MCP communication error while processing your message.",
            short_detail,
        )

    return (
        "Sorry, something went wrong while processing your message.",
        short_detail,
    )


async def generate_chat_reply(message: str, history: list | None, client_command: dict | None = None) -> dict:

    try:
        agent = await build_agent()

        normalized_history = normalize_history(history)
        safe_client_command = _normalize_client_command(client_command)

        if safe_client_command:
            # Inform the model that the frontend already resolved a valid navigation intent.
            normalized_history.append(
                {
                    "role": "system",
                    "content": (
                        "Frontend resolved navigation intent and already executed this Cesium command: "
                        f"{json.dumps(safe_client_command)}. "
                        "Treat elevator/lift as circuit id 'elevator' and avoid saying it is unknown. "
                        "Provide helpful confirmation and optional next steps."
                    ),
                }
            )

        # Build message list: system prompt first, then history, then user message.
        invoke_messages = [
            {"role": "system", "content": build_system_prompt()},
            *normalized_history,
            {"role": "user", "content": message},
        ]

        if hasattr(agent, "ainvoke"):
            result = await agent.ainvoke({"messages": invoke_messages})
        else:
            # Backward compatibility for older agent objects.
            result = await agent.arun(message, chat_history=normalized_history)

        # Extract the assistant's reply text from the agent's result.
        reply_text = extract_reply_text(result)

        # Extract any Cesium command from the agent's messages.
        cesium_command = extract_cesium_command_from_agent_messages(result.get("messages", []))

        return {
            "reply": reply_text,
            "cesiumCommand": cesium_command,
        }

    # except Exception as e:
    #     log(f"Error in generate_chat_reply: {format_exception(e)}")
    #     return {
    #         "reply": "Sorry, something went wrong while generating the response.",
    #         "cesiumCommand": None,
    #     }
    # AFTER
    except Exception as e:
        detail = format_exception(e)
        log(f"Error in generate_chat_reply: {detail}")
        msg, short_detail = summarize_chat_error(detail)
        return {
            "reply": msg,
            "cesiumCommand": None,
            "errorType": type(e).__name__,
            "errorDetail": short_detail,
        }

# Async handler for incoming MCP requests. It checks the request path and if it's /chat, it processes the chat message and history, generates a reply using the agent, and returns it as a JSON response.
# HTTP API

class ChatHandler(BaseHTTPRequestHandler):

    # Server version string.
    server_version = "ChatAPI/2.0"


    # Helper function to send JSON responses.
    def _send_json(self, status_code: int, payload: dict):

        # Encode JSON payload.
        body = json.dumps(payload).encode("utf-8")

        # Send HTTP status code.
        self.send_response(status_code)

        # Set response headers.
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))

        # Enable CORS for browser clients.
        request_origin = self.headers.get("Origin", "")
        allowed_origins = get_cors_allowed_origins()
        allow_origin = "*"
        if allowed_origins != ["*"]:
            allow_origin = request_origin if request_origin in allowed_origins else allowed_origins[0]
        self.send_header("Access-Control-Allow-Origin", allow_origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

        # End headers section.
        self.end_headers()

        # Write response body.
        self.wfile.write(body)


    # Handle CORS preflight requests.
    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})


    # Handle GET requests.
    def do_GET(self):
        log(f"[http] GET {self.path}")

        # Health check endpoint.
        if urlparse(self.path).path == "/health":
            self._send_json(200, {"status": "ok"})
            return

        if urlparse(self.path).path == "/debug/mcp":
            payload = {
                "building_mcp_url": get_building_mcp_url(),
                "cesium_mcp_url": get_cesium_mcp_url(),
            }
            self._send_json(200, payload)
            return

        if urlparse(self.path).path == "/debug/mcp-check":
            try:
                result = _run(run_mcp_checks())
                self._send_json(200, {"checks": result})
            except Exception as exc:
                self._send_json(500, {"error": format_exception(exc)[:2000]})
            return

        if urlparse(self.path).path == "/debug/mcp-tools":
            try:
                result = _run(debug_load_mcp_tools())
                self._send_json(200, result)
            except Exception as exc:
                self._send_json(500, {"error": format_exception(exc)[:4000]})
            return

        # Unknown route.
        self._send_json(404, {"error": "not found"})


    # Handle POST requests.
    def do_POST(self):
        log(f"[http] POST {self.path}")

        # Only accept /chat endpoint.
        if urlparse(self.path).path != "/chat":
            self._send_json(404, {"error": "not found"})
            return

        # Parse request body.
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        # Extract message and history.
        message = data.get("message") if isinstance(data, dict) else None
        history = data.get("history") if isinstance(data, dict) else None
        client_command = data.get("clientCommand") if isinstance(data, dict) else None

        # Validate message.
        if not isinstance(message, str) or not message.strip():
            self._send_json(400, {"error": "'message' must be a non-empty string"})
            return

        # Log incoming request.
        log(f"[chat] incoming message: {message.strip()}")

        # Execute agent logic.
        try:
            result = _run(generate_chat_reply(message.strip(), history, client_command))

            # Send response.
            self._send_json(200, result)

        # Handle errors.
        except Exception as exc:
            detail = format_exception(exc)
            log("[chat] ERROR:\n" + detail)
            self._send_json(500, {"error": "internal error", "detail": detail[:2000]})


# ======================================================================================
# Entrypoint


# Function that starts the HTTP API server.
def run_chat_api(host: str, port: int):

    # Log startup message.
    log(f"Chat API running http://{host}:{port}")

    # Start multithreaded HTTP server.
    ThreadingHTTPServer((host, port), ChatHandler).serve_forever()


# Script entry point.
# if __name__ == "__main__":

#     # Load environment variables from .env file.
#     load_local_env_file()

#     # Create CLI argument parser.
#     parser = argparse.ArgumentParser(description="Chat API using LangChain agent + MCP servers")

#     # Host argument.
#     parser.add_argument("--host", default="127.0.0.1")

#     # Port argument.
#     parser.add_argument("--port", type=int, default=8010)

#     # Parse CLI arguments.
#     args = parser.parse_args()

#     # Start server.
#     run_chat_api(args.host, args.port)


if __name__ == "__main__":
    load_local_env_file()


    import sys
    cfg = get_openai_config()
    if not cfg["api_key"]:
        print("ERROR: OPENAI_API_KEY is missing or empty. "
              "Add it to your .env file and restart.", file=sys.stderr)
        sys.exit(1)
    print(f"[startup] OpenAI model: {cfg['model']}")
    print(f"[startup] Building MCP: {get_building_mcp_url()}")
    print(f"[startup]  Cesium MCP: {get_cesium_mcp_url()}")


    parser = argparse.ArgumentParser(description="Chat API using LangChain agent + MCP servers")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8010")))
    args = parser.parse_args()

    run_chat_api(args.host, args.port)



               

        
