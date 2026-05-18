"""
Supabase REST API-based forecast provider.
Queries Supabase via HTTP API instead of direct PostgreSQL connection.
Works through firewalls that block port 5432.
"""

import logging
from typing import Literal

import httpx

from app.normalization.forecast_normalizer import ForecastNormalizer
from app.providers.forecast_provider import ForecastProvider
from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)


class SupabaseRestForecastProvider(ForecastProvider):
    """Provides forecasts from Supabase via REST API."""

    def __init__(self, supabase_url: str, secret_key: str):
        """
        Initialize Supabase REST provider.

        Args:
            supabase_url: Supabase project URL (e.g., https://project.supabase.co)
            secret_key: Supabase secret API key (service_role key)
        """
        self.base_url = supabase_url.rstrip("/")
        self.secret_key = secret_key
        self.headers = {
            "apikey": secret_key,
            "Content-Type": "application/json",
        }

    @property
    def source_name(self) -> str:
        return "supabase_rest"

    async def get_forecasts(
        self,
        scope: Literal["local", "global"],
        product: Literal["short_term", "long_term"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        """
        Retrieve forecasts from Supabase REST API.

        Args:
            scope: "local" or "global"
            product: "short_term" or "long_term"
            mode: Retrieval mode (single or compare)
            circuit_id: Circuit identifier

        Returns:
            List of normalized forecast records

        Raises:
            httpx.HTTPError: If API request fails
        """
        # Determine table name
        if scope == "local" and product == "short_term":
            table = "unified_local_short_term"
        elif scope == "local" and product == "long_term":
            table = "unified_local_long_term"
        elif scope == "global" and product == "short_term":
            table = "unified_global_short_term"
        elif scope == "global" and product == "long_term":
            table = "unified_global_long_term"
        else:
            logger.warning(f"Invalid scope/product: {scope}/{product}")
            return []

        try:
            # Build query
            url = f"{self.base_url}/rest/v1/{table}"
            params = {
                "select": "*",
                "order": "forecast_timestamp.asc",
            }

            # Add filters based on mode
            if scope == "local" and mode == "single" and circuit_id:
                params["circuit_id"] = f"eq.{circuit_id}"
            elif scope == "local" and mode == "compare" and circuit_id:
                params["circuit_id"] = f"eq.{circuit_id}"

            logger.debug(f"Querying Supabase: {table} with params {params}")

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params, headers=self.headers)
                response.raise_for_status()
                data = response.json()

            if not data:
                logger.debug(f"No rows from Supabase for {table}")
                return []

            # Normalize records
            records = ForecastNormalizer.normalize_records(data, scope, product)
            records = ForecastNormalizer.deduplicate_and_sort(records)
            logger.info(f"Retrieved {len(records)} records from Supabase REST API")
            return records

        except httpx.HTTPStatusError as e:
            logger.error(f"Supabase API error ({e.response.status_code}): {e.response.text}")
            raise
        except httpx.RequestError as e:
            logger.error(f"Supabase connection error: {e}")
            raise
        except Exception as e:
            logger.error(f"Supabase query failed: {e}")
            raise
