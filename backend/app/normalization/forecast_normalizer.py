import logging
from datetime import datetime

from app.schemas.forecast import ForecastRecord

logger = logging.getLogger(__name__)


class ForecastNormalizer:

    @staticmethod
    def normalize_record(
        row: dict | object,
        scope: str,
        product: str,
        series_name: str | None = None,
    ) -> ForecastRecord:
        if hasattr(row, "_mapping"):
            row_dict = dict(row._mapping)
        elif hasattr(row, "__dict__"):
            row_dict = {k: v for k, v in row.__dict__.items() if not k.startswith("_")}
        else:
            row_dict = dict(row) if isinstance(row, dict) else row

        timestamp_val = row_dict.get("forecast_timestamp") or row_dict.get("timestamp")
        if not timestamp_val:
            raise ValueError("Missing required timestamp field")

        if isinstance(timestamp_val, str):
            timestamp_val = datetime.fromisoformat(timestamp_val.replace("Z", "+00:00"))

        value = row_dict.get("forecast_value")
        if value is None:
            value = row_dict.get("global_prediction")
        if value is None:
            value = row_dict.get("predicted_value")
        if value is None:
            value = row_dict.get("value")
        if value is None:
            raise ValueError("Missing required value field")

        circuit_id = row_dict.get("circuit_id") or row_dict.get("meter")
        if not circuit_id:
            circuit_id = "global" if scope == "global" else None
        if not circuit_id and scope != "global":
            raise ValueError("Missing circuit_id for local forecast")

        generated_at_val = row_dict.get("generated_at") or row_dict.get("run_time")
        if generated_at_val is None:
            generated_at_val = datetime.utcnow()
        elif isinstance(generated_at_val, str):
            generated_at_val = datetime.fromisoformat(generated_at_val.replace("Z", "+00:00"))

        return ForecastRecord(
            series_name=series_name or row_dict.get("model_type") or row_dict.get("series_name") or "forecast",
            circuit_id=circuit_id,
            forecast_timestamp=timestamp_val,
            forecast_value=float(value),
            step_ahead=int(row_dict.get("step_ahead") or 0),
            generated_at=generated_at_val,
            model_type=row_dict.get("model_type") or row_dict.get("series_name") or "unknown",
            model_version=row_dict.get("model_version") or "unknown",
            resolution=row_dict.get("resolution") or "unknown",
            scope=scope,
            product=product,
        )

    @staticmethod
    def normalize_records(
        rows: list,
        scope: str,
        product: str,
        series_name: str | None = None,
    ) -> list[ForecastRecord]:
        records = []
        for idx, row in enumerate(rows):
            try:
                record = ForecastNormalizer.normalize_record(row, scope, product, series_name)
                records.append(record)
            except ValueError as e:
                logger.warning(f"Failed to normalize record at index {idx}: {e}")
                continue
        return records

    @staticmethod
    def deduplicate_and_sort(records: list[ForecastRecord]) -> list[ForecastRecord]:
        dedup_map = {}
        for record in records:
            key = (record.circuit_id, record.forecast_timestamp, record.resolution)
            if key not in dedup_map or record.generated_at > dedup_map[key].generated_at:
                dedup_map[key] = record
        return sorted(dedup_map.values(), key=lambda r: r.forecast_timestamp)
