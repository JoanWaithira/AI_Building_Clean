"""
Fallback forecast provider that tries: Database → Supabase REST API → CSV.
"""

import logging
from typing import Literal

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.providers.csv_forecast_provider import CsvForecastProvider
from app.providers.db_forecast_provider import DbForecastProvider
from app.providers.forecast_provider import ForecastProvider
from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)


class FallbackForecastProvider(ForecastProvider):
    """
    Orchestrator that tries DB first, then Supabase REST API, then CSV.
    Provides automatic error recovery and source switching.
    """

    def __init__(self, db_session: Session, supabase_provider=None, csv_dir: str | None = None):
        """
        Initialize fallback provider.

        Args:
            db_session: SQLAlchemy session for primary database
            supabase_provider: Optional Supabase REST API provider
            csv_dir: Optional override for CSV directory
        """
        self.db_provider = DbForecastProvider(db_session)
        self.supabase_provider = supabase_provider
        self.csv_provider = CsvForecastProvider(csv_dir)
        self._last_source: str | None = None

    @property
    def source_name(self) -> str:
        """Return the source that was actually used."""
        return self._last_source or "unknown"

    async def get_forecasts(
        self,
        scope: Literal["local", "global"],
        product: Literal["short_term", "long_term"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        """
        Retrieve forecasts, trying DB → Supabase REST API → CSV.

        Args:
            scope: "local" or "global"
            product: "short_term" or "long_term"
            mode: "single" or "compare"
            circuit_id: Circuit identifier

        Returns:
            List of normalized forecast records from successful provider
            Empty list if all sources fail

        Strategy:
            1. Try primary database - if succeeds and has data, return
            2. If DB fails or empty, try Supabase REST API
            3. If Supabase fails or empty, try CSV
            4. If all fail, return empty list (no crash)
        """
        # Try primary database first
        try:
            logger.debug(f"Attempting primary DB query for scope={scope}, product={product}")
            records = await self.db_provider.get_forecasts(scope, product, mode, circuit_id)

            if records:
                self._last_source = "database"
                logger.info(f"Using database source: {len(records)} records")
                return records
            else:
                logger.debug("Primary DB returned empty result, trying Supabase")

        except SQLAlchemyError as e:
            logger.warning(f"Primary DB query failed ({type(e).__name__}), trying Supabase: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in primary DB provider: {e}")

        # Try Supabase REST API fallback
        if self.supabase_provider:
            try:
                logger.debug(f"Attempting Supabase REST API query for scope={scope}, product={product}")
                records = await self.supabase_provider.get_forecasts(scope, product, mode, circuit_id)

                if records:
                    self._last_source = "supabase_rest"
                    logger.info(f"Using Supabase REST API source: {len(records)} records")
                    return records
                else:
                    logger.debug("Supabase returned empty result, trying CSV fallback")

            except Exception as e:
                logger.warning(f"Supabase query failed ({type(e).__name__}), trying CSV: {e}")
        else:
            logger.debug("Supabase not configured, skipping to CSV fallback")

        # Fallback to CSV
        try:
            logger.debug(f"Attempting CSV query for scope={scope}, product={product}")
            records = await self.csv_provider.get_forecasts(scope, product, mode, circuit_id)

            if records:
                self._last_source = "csv"
                logger.info(f"Using CSV source: {len(records)} records")
                return records
            else:
                logger.warning("CSV returned empty result, no more sources to try")

        except FileNotFoundError as e:
            logger.error(f"CSV file not found: {e}")
        except Exception as e:
            logger.error(f"CSV query failed: {e}")

        # All sources exhausted
        self._last_source = None
        logger.error("All forecast sources exhausted, returning empty result")
        return []
