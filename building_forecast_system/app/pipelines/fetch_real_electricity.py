from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd

from app.clients.gate_api import GateAPIClient


def flatten_electricity_response(data: list) -> pd.DataFrame:
    rows = []

    for item in data:
        meter = item.get("meter")
        meter_type = item.get("meter_type")
        unit = item.get("unit")
        readings = item.get("readings", [])

        for reading in readings:
            rows.append(
                {
                    "meter": meter,
                    "meter_type": meter_type,
                    "unit": unit,
                    "reading_id": reading.get("id"),
                    "timestamp": reading.get("timestamp"),
                    "value": reading.get("value"),
                }
            )

    df = pd.DataFrame(rows)

    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.sort_values("timestamp").reset_index(drop=True)

    return df


def run():
    client = GateAPIClient()

    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=7)

    start_date = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_date = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    data = client.get_electricity_data(
        meter="BuildingMain",
        meter_type="Power",
        start_date=start_date,
        end_date=end_date,
    )

    df = flatten_electricity_response(data)

    if df.empty:
        print("No electricity readings returned.")
        return

    output_dir = Path("data/raw")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / "buildingmain_power_last_7_days.csv"
    df.to_csv(output_file, index=False)

    print(f"Saved {len(df)} rows to {output_file}")
    print(df.head())


if __name__ == "__main__":
    run()