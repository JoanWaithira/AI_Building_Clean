import os
from urllib.parse import unquote_plus

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(prefix="/gate-api", tags=["gate-api-proxy"])

GATE_API_BASE = os.getenv(
    "GATE_REALTIME_API_URL",
    "https://citylab.gate-ai.eu/gate-building/api",
).rstrip("/")

GATE_API_KEY = os.getenv("GATE_REALTIME_API_KEY", "")


def normalize_gate_query_params(request: Request) -> dict:
    """
    Normalize query params before forwarding them to the GATE API.

    The frontend/browser may send datetime values with encoded spaces, plus signs,
    or ISO-like timestamps. The GATE API expects:
      YYYY-MM-DD HH:MM:SS
    """
    params = dict(request.query_params)

    for key in ("start_date", "end_date"):
        value = params.get(key)

        if not value:
            continue

        normalized = unquote_plus(str(value))
        normalized = normalized.replace("T", " ")
        normalized = normalized.split(".")[0]

        if normalized.endswith("Z"):
            normalized = normalized[:-1]

        if len(normalized) > 19:
            normalized = normalized[:19]

        params[key] = normalized

    return params


@router.api_route("/{path:path}", methods=["GET"])
async def proxy_gate_api(path: str, request: Request):
    if not GATE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GATE API key is not configured on the server",
        )

    target_url = f"{GATE_API_BASE}/{path.lstrip('/')}"

    headers = {
        "Accept": request.headers.get("accept", "application/json"),
        "X-API-Key": GATE_API_KEY,
    }

    params = normalize_gate_query_params(request)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            upstream = await client.get(
                target_url,
                params=params,
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"GATE API request failed: {exc}",
        ) from exc

    excluded_headers = {
        "content-encoding",
        "transfer-encoding",
        "connection",
        "keep-alive",
    }

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in excluded_headers
    }

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
