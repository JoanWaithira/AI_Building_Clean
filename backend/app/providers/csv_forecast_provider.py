"""
CSV-based forecast provider for fallback/standalone use.
"""

import csv
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Literal

from app.normalization.forecast_normalizer import ForecastNormalizer
from app.providers.forecast_provider import ForecastProvider
from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)

# CSV file paths
CSV_BASE_DIR = os.getenv(
    "FORECAST_CSV_DIR", "c:\\building_forecast_system\\data\\forecasts"
)

CSV_FILES = {
    ("local", "short_term"): "unified_local_short_term.csv",
    ("local", "long_term"): "unified_local_long_term.csv",
    ("global", "short_term"): "unified_global_short_term.csv",
    ("global", "long_term"): "unified_global_long_term.csv",
}


class CsvForecastProvider(ForecastProvider):
    """Provides forecasts from local CSV files."""

    def __init__(self, csv_dir: str | None = None):
        """
        Initialize CSV provider.

        Args:
            csv_dir: Override CSV directory path
        """
        self.csv_dir = csv_dir or CSV_BASE_DIR

    @property
    def source_name(self) -> str:
        return "csv"

    def _get_csv_path(
        self, scope: Literal["local", "global"], product: Literal["short_term", "long_term"]
    ) -> str:
        """Get full path to CSV file."""
        filename = CSV_FILES.get((scope, product))
        if not filename:
            raise ValueError(f"No CSV mapping for scope={scope}, product={product}")
        return os.path.join(self.csv_dir, filename)

    def _filter_records(
        self,
        records: list[ForecastRecord],
        scope: Literal["local", "global"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        """Apply mode and circuit filtering."""
        if scope == "local" and mode == "single":
            if not circuit_id:
                logger.warning("circuit_id required for local/single mode")
                return []
            return [r for r in records if r.circuit_id.lower() == circuit_id.lower()]
        elif scope == "local" and mode == "compare":
            if circuit_id:
                return [r for r in records if r.circuit_id.lower() == circuit_id.lower()]
            return records
        else:  # global
            return records

    async def get_forecasts(
        self,
        scope: Literal["local", "global"],
        product: Literal["short_term", "long_term"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        """
        Retrieve forecasts from CSV file.

        Args:
            scope: "local" or "global"
            product: "short_term" or "long_term"
            mode: "single" or "compare"
            circuit_id: Circuit identifier

        Returns:
            List of normalized forecast records

        Raises:
            FileNotFoundError: If CSV file not found
            ValueError: If CSV parsing fails
        """
        try:
            csv_path = self._get_csv_path(scope, product)

            if not os.path.exists(csv_path):
                logger.warning(f"CSV file not found: {csv_path}")
                return []

            # Read CSV
            rows = []
            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                if not reader.fieldnames:
                    logger.warning(f"CSV file is empty: {csv_path}")
                    return []
                rows = list(reader)

            if not rows:
                logger.debug(f"No rows in CSV: {csv_path}")
                return []

            # Normalize
            records = ForecastNormalizer.normalize_records(rows, scope, product)

            # Deduplicate and sort
            records = ForecastNormalizer.deduplicate_and_sort(records)

            # Filter by mode/circuit
            records = self._filter_records(records, scope, mode, circuit_id)

            logger.info(f"Retrieved {len(records)} records from CSV: {os.path.basename(csv_path)}")
            return records

        except Exception as e:
            logger.error(f"CSV query failed: {e}")
            raise
