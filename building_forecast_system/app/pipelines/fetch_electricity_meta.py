import pandas as pd
from pathlib import Path
from app.clients.gate_api import GateAPIClient


def run():
    client = GateAPIClient()
    data = client.get_electricity_meta()

    df = pd.DataFrame(data)

    output_dir = Path("data/raw")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / "electricity_meta.csv"
    df.to_csv(output_file, index=False)

    print(f"Saved {len(df)} meter metadata rows to {output_file}")
    print(df.head())


if __name__ == "__main__":
    run()