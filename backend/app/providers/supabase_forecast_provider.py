"""
Supabase-based forecast provider using SQLAlchemy.
Queries the same tables as the primary database but from Supabase (PostgreSQL).
"""

import logging
from typing import Literal

from sqlalchemy import and_, func, literal, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import (
    ForecastGlobal,
    UnifiedLocalLongTerm,
    UnifiedLocalShortTerm,
)
from app.normalization.forecast_normalizer import ForecastNormalizer
from app.providers.forecast_provider import ForecastProvider
from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)


class SupabaseForecastProvider(ForecastProvider):
    """Provides forecasts from Supabase (PostgreSQL) database."""

    def __init__(self, db_session: Session):
        """
        Initialize Supabase provider with active session.

        Args:
            db_session: SQLAlchemy session connected to Supabase
        """
        self.db = db_session

    @property
    def source_name(self) -> str:
        return "supabase"

    def _build_query(
        self, scope: Literal["local", "global"], product: Literal["short_term", "long_term"]
    ):
        """Build a normalized select statement for the requested forecast slice."""
        if scope == "local" and product == "short_term":
            table_model = UnifiedLocalShortTerm
            stmt = select(
                table_model.circuit_id.label("circuit_id"),
                table_model.forecast_timestamp.label("forecast_timestamp"),
                table_model.forecast_value.label("forecast_value"),
                table_model.step_ahead.label("step_ahead"),
                table_model.generated_at.label("generated_at"),
                table_model.model_type.label("model_type"),
                table_model.model_version.label("model_version"),
                table_model.resolution.label("resolution"),
            )
            return table_model, stmt

        if scope == "local" and product == "long_term":
            table_model = UnifiedLocalLongTerm
            stmt = select(
                table_model.circuit_id.label("circuit_id"),
                table_model.forecast_timestamp.label("forecast_timestamp"),
                table_model.forecast_value.label("forecast_value"),
                table_model.step_ahead.label("step_ahead"),
                table_model.generated_at.label("generated_at"),
                table_model.model_type.label("model_type"),
                table_model.model_version.label("model_version"),
                table_model.resolution.label("resolution"),
            )
            return table_model, stmt

        if scope == "global":
            table_model = ForecastGlobal
            stmt = select(
                literal("global").label("circuit_id"),
                table_model.forecast_timestamp.label("forecast_timestamp"),
                table_model.global_prediction.label("forecast_value"),
                table_model.step_ahead.label("step_ahead"),
                table_model.generated_at.label("generated_at"),
                literal("global").label("model_type"),
                table_model.model_version.label("model_version"),
                table_model.resolution.label("resolution"),
            )
            return table_model, stmt

        return None, None

    async def get_forecasts(
        self,
        scope: Literal["local", "global"],
        product: Literal["short_term", "long_term"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        """
        Retrieve forecasts from Supabase.

        Args:
            scope: "local" or "global"
            product: "short_term" or "long_term"
            mode: Retrieval mode (single or compare)
            circuit_id: Circuit identifier

        Returns:
            List of normalized forecast records

        Raises:
            SQLAlchemyError: If database query fails
        """
        try:
            table_model, stmt = self._build_query(scope, product)
            if not table_model or stmt is None:
                logger.warning(f"No table model for scope={scope}, product={product}")
                return []

            # Build filters
            filters = []

            # For local/single mode, require circuit_id
            if scope == "local" and mode == "single":
                if not circuit_id:
                    logger.warning("circuit_id required for local/single mode")
                    return []
                filters.append(func.lower(table_model.circuit_id) == circuit_id.lower())
            # For local/compare mode, retrieve all unless specific circuit
            elif scope == "local" and mode == "compare":
                if circuit_id:
                    filters.append(func.lower(table_model.circuit_id) == circuit_id.lower())
            # For global, circuit_id should be "global" (as per CSV)
            # but we don't filter on it; retrieve all rows (should be "global")

            # Execute query
            stmt = stmt.where(and_(*filters) if filters else True).order_by(
                table_model.forecast_timestamp.asc()
            )

            rows = self.db.execute(stmt).all()
            if not rows:
                logger.debug(f"No rows from Supabase for scope={scope}, product={product}")
                return []

            # Normalize
            records = ForecastNormalizer.normalize_records(rows, scope, product)
            records = ForecastNormalizer.deduplicate_and_sort(records)
            logger.info(f"Retrieved {len(records)} records from Supabase")
            return records

        except SQLAlchemyError as e:
            logger.error(f"Supabase query failed: {e}")
            raise
