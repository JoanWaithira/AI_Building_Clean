"""
CSV-only forecast fallback route.
This endpoint serves forecast data directly from CSV files.
No database dependency, always available.

All CSV files are loaded into memory once at startup and indexed by circuit_id,
so every request is a fast in-memory lookup with no disk I/O.
"""

import csv
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forecasts-csv", tags=["forecasts-csv"])

# CSV file paths - resolve relative to the repo root unless FORECAST_CSV_DIR overrides it
_default_csv_dir = str(
    Path(__file__).resolve().parents[3] / "my-building" / "public" / "floorplans"
)
CSV_BASE_DIR = os.getenv("FORECAST_CSV_DIR", _default_csv_dir)

CSV_FILES = {
    ("local", "short_term"): "unified_local_short_term.csv",
    ("local", "long_term"): "unified_local_long_term.csv",
    ("global", "short_term"): "unified_global_short_term.csv",
    ("global", "long_term"): "unified_global_long_term.csv",
}

# ── In-memory cache: (scope, product) → {circuit_id_lower: [records], "global": [records]} ──
_CACHE: Dict[tuple, Dict[str, List[dict]]] = {}


def _load_csv_to_cache(scope: str, product: str) -> None:
    """Load a CSV file into the in-memory cache, indexed by lowercase circuit_id."""
    key = (scope, product)
    filename = CSV_FILES.get(key)
    if not filename:
        logger.warning(f"No CSV file mapped for {scope}/{product}")
        _CACHE[key] = {}
        return

    csv_path = os.path.join(CSV_BASE_DIR, filename)
    if not os.path.exists(csv_path):
        logger.warning(f"CSV file not found: {csv_path}")
        _CACHE[key] = {}
        return

    index: Dict[str, List[dict]] = defaultdict(list)
    product_label = "short_term" if "short" in product else "long_term"
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cid = (row.get("circuit_id") or "global").strip()
                record = {
                    "series_name": row.get("model_type", "forecast"),
                    "circuit_id": cid,
                    "forecast_timestamp": row.get("forecast_timestamp"),
                    "forecast_value": float(row.get("forecast_value") or 0),
                    "step_ahead": int(row.get("step_ahead") or 0),
                    "generated_at": row.get("generated_at"),
                    "model_type": row.get("model_type", "unknown"),
                    "model_version": row.get("model_version", "unknown"),
                    "resolution": row.get("resolution", "unknown"),
                    "scope": scope,
                    "product": product_label,
                }
                index[cid.lower()].append(record)
        total = sum(len(v) for v in index.values())
        logger.info(f"Cached {total} records from {filename} ({len(index)} circuits)")
    except Exception as e:
        logger.error(f"Error loading CSV {csv_path}: {e}")

    _CACHE[key] = dict(index)


def _warm_cache() -> None:
    """Pre-load all 4 CSV files into memory."""
    for scope_product in CSV_FILES:
        _load_csv_to_cache(*scope_product)

# Load everything at import time (uvicorn worker startup)
_warm_cache()


def _lookup(scope: str, product: str, circuit_id: str | None) -> List[dict]:
    """Return cached records, optionally filtered by circuit_id."""
    key = (scope, product)
    if key not in _CACHE:
        _load_csv_to_cache(scope, product)

    index = _CACHE.get(key, {})
    if not circuit_id:
        # Return all records flattened
        return [r for records in index.values() for r in records]

    # Try exact lowercase match first, then case-insensitive scan
    cid_lower = circuit_id.lower()
    if cid_lower in index:
        return index[cid_lower]

    # Fallback: partial match (e.g. "buildingmain" matches "BuildingMain")
    for key_cid, records in index.items():
        if key_cid == cid_lower:
            return records

    logger.warning(f"No cached records for circuit_id='{circuit_id}' in {scope}/{product}. Available: {list(index.keys())[:10]}")
    return []


@router.get("/local/short")
def get_local_short_csv(
    circuit_id: str | None = Query(None, description="Circuit ID"),
) -> dict:
    """Get local short-term forecasts from in-memory cache."""
    data = _lookup("local", "short_term", circuit_id)
    return {"scope": "local", "product": "short_term", "circuit_id": circuit_id, "data": data, "source": "csv"}


@router.get("/local/long")
def get_local_long_csv(
    circuit_id: str | None = Query(None, description="Circuit ID"),
) -> dict:
    """Get local long-term forecasts from in-memory cache."""
    data = _lookup("local", "long_term", circuit_id)
    return {"scope": "local", "product": "long_term", "circuit_id": circuit_id, "data": data, "source": "csv"}


@router.get("/global/short")
def get_global_short_csv() -> dict:
    """Get global short-term forecasts from in-memory cache."""
    data = _lookup("global", "short_term", None)
    return {"scope": "global", "product": "short_term", "data": data, "source": "csv"}


@router.get("/global/long")
def get_global_long_csv() -> dict:
    """Get global long-term forecasts from in-memory cache."""
    data = _lookup("global", "long_term", None)
    return {
        "scope": "global",
        "product": "long_term",
        "data": data,
        "source": "csv",
    }
