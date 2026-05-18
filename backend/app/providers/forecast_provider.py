import logging
from abc import ABC, abstractmethod
from typing import Literal

from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)


class ForecastProvider(ABC):

    @abstractmethod
    async def get_forecasts(
        self,
        scope: Literal["local", "global"],
        product: Literal["short_term", "long_term"],
        mode: Literal["single", "compare"],
        circuit_id: str | None = None,
    ) -> list[ForecastRecord]:
        pass

    @property
    @abstractmethod
    def source_name(self) -> str:
        pass
