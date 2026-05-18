from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd
import re

from app.clients.gate_api import GateAPIClient


RAW_DIR = Path("data/raw")


def safe_filename(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def flatten_response(data: list) -> pd.DataFrame:
    rows = []

    for item in data:
        meter = item.get("meter")
        meter_type = item.get("meter_type")
        unit = item.get("unit")

        readings = item.get("readings", [])

        for r in readings:
            rows.append(
                {
                    "meter": meter,
                    "meter_type": meter_type,
                    "unit": unit,
                    "reading_id": r.get("id"),
                    "timestamp": r.get("timestamp"),
                    "value": r.get("value"),
                }
            )

    df = pd.DataFrame(rows)

    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed", utc=True)
        df = df.sort_values("timestamp")

    return df


def run(days_back: int = 30):

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    print("Starting circuit data fetch")

    client = GateAPIClient()

    # get metadata
    meta = client.get_electricity_meta()
    meta_df = pd.DataFrame(meta)

    meta_file = RAW_DIR / "electricity_meta.csv"
    meta_df.to_csv(meta_file, index=False)

    meters = meta_df["meter"].dropna().unique()

    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=days_back)

    start_date = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_date = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    print(f"Fetching data from {start_date} to {end_date}")
    print(f"Total meters found: {len(meters)}")

    for meter in meters:

        try:

            print(f"Fetching {meter}")

            data = client.get_electricity_data(
                meter=meter,
                meter_type="Power",
                start_date=start_date,
                end_date=end_date,
            )

            df = flatten_response(data)

            if df.empty:
                print("No data returned")
                continue

            file_name = f"{safe_filename(meter)}_power.csv"
            file_path = RAW_DIR / file_name

            df.to_csv(file_path, index=False)

            print(f"Saved {len(df)} rows → {file_path}")

        except Exception as e:
            print(f"Failed for meter {meter}: {e}")

    print("Finished fetching all circuits")


if __name__ == "__main__":
    run()
