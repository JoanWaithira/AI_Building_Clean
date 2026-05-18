import pandas as pd

from app.utils.cyclic_features import add_cyclic_encoding


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["month"] = df["timestamp"].dt.month
    df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    df = add_cyclic_encoding(df)

    return df


def add_lag_features(df: pd.DataFrame, target_col: str = "value", lags=None) -> pd.DataFrame:
    df = df.copy()

    if lags is None:
        lags = [1, 2, 3, 6, 12, 24, 288]

    for lag in lags:
        df[f"lag_{lag}"] = df[target_col].shift(lag)

    return df


def add_rolling_features(df: pd.DataFrame, target_col: str = "value") -> pd.DataFrame:
    df = df.copy()

    df["roll_mean_12"] = df[target_col].rolling(12).mean()
    df["roll_std_12"] = df[target_col].rolling(12).std()
    df["roll_mean_288"] = df[target_col].rolling(288).mean()

    return df


def build_short_term_dataset(df: pd.DataFrame):
    df = df.copy()

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    df = add_time_features(df)
    df = add_lag_features(df)
    df = add_rolling_features(df)

    # one-step-ahead target
    df["target"] = df["value"].shift(-1)

    df = df.dropna().reset_index(drop=True)

    feature_cols = [
        c for c in df.columns
        if c not in ["timestamp", "target", "value"]
    ]

    return df, feature_cols