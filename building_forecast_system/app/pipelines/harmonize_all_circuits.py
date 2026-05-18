from pathlib import Path
import pandas as pd


RAW_DIR = Path("data/raw")
PROCESSED_DIR = Path("data/processed")

FREQ = "5min"  # harmonization resolution


def clean_series(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # keep only columns needed for cleaning
    required_cols = ["timestamp", "value"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df[required_cols].copy()

    # parse timestamp and numeric value
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    # drop broken rows
    df = df.dropna(subset=["timestamp", "value"])

    if df.empty:
        raise ValueError("No valid timestamp/value rows after parsing.")

    df = df.sort_values("timestamp")
    df = df.set_index("timestamp")

    # remove duplicate timestamps
    df = df[~df.index.duplicated(keep="last")]

    # resample only the numeric value column
    df = df[["value"]].resample(FREQ).mean()

    # fill small gaps
    df["value"] = df["value"].interpolate(limit_direction="both")

    # clip extreme spikes
    q_low = df["value"].quantile(0.01)
    q_high = df["value"].quantile(0.99)

    df["value"] = df["value"].clip(q_low, q_high)

    df = df.reset_index()

    return df


def run():
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    files = list(RAW_DIR.glob("*_power.csv"))

    print(f"Found {len(files)} circuit files")

    for file in files:
        try:
            print(f"Processing {file.name}")

            df = pd.read_csv(file)

            if df.empty:
                print("Empty file")
                continue

            clean_df = clean_series(df)

            output_file = PROCESSED_DIR / file.name.replace("_power", "_clean")

            clean_df.to_csv(output_file, index=False)

            print(f"Saved cleaned file -> {output_file}")

        except Exception as e:
            print(f"Failed cleaning {file.name}: {e}")

    print("Finished harmonizing all circuits")


if __name__ == "__main__":
    run()