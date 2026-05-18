import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db, get_supabase_provider
from app.providers.fallback_forecast_provider import FallbackForecastProvider
from app.schemas.forecast import ForecastResponse, ForecastRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forecasts", tags=["forecasts"])


def get_forecast_provider(
    db: Session = Depends(get_db),
) -> FallbackForecastProvider:
    supabase_provider = get_supabase_provider()
    return FallbackForecastProvider(db, supabase_provider)


@router.get("/", response_model=ForecastResponse)
async def get_forecasts(
    scope: Literal["local", "global"] = Query(description="Forecast scope"),
    product: Literal["short_term", "long_term"] = Query(description="Forecast product"),
    mode: Literal["single", "compare"] = Query(default="single", description="Retrieval mode"),
    circuit_id: str | None = Query(None, description="Circuit/meter ID (required for local/single)"),
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> ForecastResponse:
    try:
        if scope == "local" and mode == "single" and not circuit_id:
            raise HTTPException(
                status_code=400,
                detail="circuit_id is required for local scope in single mode",
            )

        logger.info(f"Fetching forecasts: scope={scope}, product={product}, mode={mode}, circuit_id={circuit_id}")

        records = await provider.get_forecasts(scope, product, mode, circuit_id)

        if not records:
            logger.warning(f"No forecasts found for given parameters")
            return ForecastResponse(
                scope=scope, product=product, mode=mode, circuit_id=circuit_id,
                data=[], source=provider.source_name, error="No forecast data available",
            )

        logger.info(f"Successfully fetched {len(records)} forecasts from {provider.source_name}")
        return ForecastResponse(
            scope=scope, product=product, mode=mode, circuit_id=circuit_id,
            data=records, source=provider.source_name,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching forecasts: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/local/short", response_model=ForecastResponse)
async def get_local_short_forecasts(
    circuit_id: str | None = Query(None),
    mode: Literal["single", "compare"] = Query(default="single"),
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> ForecastResponse:
    if mode == "single" and not circuit_id:
        raise HTTPException(status_code=400, detail="circuit_id required for single mode")
    records = await provider.get_forecasts("local", "short_term", mode, circuit_id)
    return ForecastResponse(
        scope="local", product="short_term", mode=mode, circuit_id=circuit_id,
        data=records, source=provider.source_name,
        error="No data found" if not records else None,
    )


@router.get("/local/long", response_model=ForecastResponse)
async def get_local_long_forecasts(
    circuit_id: str | None = Query(None),
    mode: Literal["single", "compare"] = Query(default="single"),
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> ForecastResponse:
    if mode == "single" and not circuit_id:
        raise HTTPException(status_code=400, detail="circuit_id required for single mode")
    records = await provider.get_forecasts("local", "long_term", mode, circuit_id)
    return ForecastResponse(
        scope="local", product="long_term", mode=mode, circuit_id=circuit_id,
        data=records, source=provider.source_name,
        error="No data found" if not records else None,
    )


@router.get("/global/short", response_model=ForecastResponse)
async def get_global_short_forecasts(
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> ForecastResponse:
    records = await provider.get_forecasts("global", "short_term", "single")
    return ForecastResponse(
        scope="global", product="short_term", mode="single",
        data=records, source=provider.source_name,
        error="No data found" if not records else None,
    )


@router.get("/global/long", response_model=ForecastResponse)
async def get_global_long_forecasts(
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> ForecastResponse:
    records = await provider.get_forecasts("global", "long_term", "single")
    return ForecastResponse(
        scope="global", product="long_term", mode="single",
        data=records, source=provider.source_name,
        error="No data found" if not records else None,
    )


@router.post("/refresh")
async def refresh_forecasts(
    scope: Literal["local", "global"] = Query(description="Forecast scope"),
    product: Literal["short_term", "long_term"] = Query(description="Forecast product"),
    circuit_id: str | None = Query(None),
    provider: FallbackForecastProvider = Depends(get_forecast_provider),
) -> dict:
    try:
        mode = "single" if circuit_id else "compare"
        logger.info(f"Manual refresh: scope={scope}, product={product}")
        records = await provider.get_forecasts(scope, product, mode, circuit_id)
        return {
            "status": "success",
            "message": f"Refreshed {len(records)} forecasts",
            "count": len(records),
            "source": provider.source_name,
        }
    except Exception as e:
        logger.exception(f"Refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Refresh failed: {str(e)}")
