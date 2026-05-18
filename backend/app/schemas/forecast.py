from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ForecastRecord(BaseModel):
    series_name: str
    circuit_id: str
    forecast_timestamp: datetime
    forecast_value: float
    step_ahead: int
    generated_at: datetime
    model_type: str
    model_version: str
    resolution: str
    scope: Literal["local", "global"]
    product: Literal["short_term", "long_term"]


class ForecastResponse(BaseModel):
    scope: Literal["local", "global"]
    product: Literal["short_term", "long_term"]
    mode: Literal["single", "compare"]
    circuit_id: str | None = None
    data: list[ForecastRecord] = Field(default_factory=list)
    source: Literal["database", "csv", "unknown"] | None = None
    error: str | None = None


class ForecastRequest(BaseModel):
    scope: Literal["local", "global"]
    product: Literal["short_term", "long_term"]
    mode: Literal["single", "compare"]
    circuit_id: str | None = None
