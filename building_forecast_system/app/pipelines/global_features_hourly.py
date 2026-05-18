from __future__ import annotations

from typing import Iterable

import pandas as pd


BASE_TARGET_COL = "target"


def merge_global_with_weather(global_df: pd.DataFrame, weather_df: pd.DataFrame) -> pd.DataFrame:
    global_df = global_df.copy()
    weather_df = weather_df.copy()

    global_df["timestamp"] = pd.to_datetime(global_df["timestamp"], utc=True)
    weather_df["timestamp"] = pd.to_datetime(weather_df["timestamp"], utc=True)

    global_df = global_df.sort_values("timestamp")
    weather_df = weather_df.sort_values("timestamp")

    weather_cols = [c for c in weather_df.columns if c != "timestamp"]
    for col in weather_cols:
        weather_df[col] = pd.to_numeric(weather_df[col], errors="coerce")

    merged = global_df.merge(weather_df, on="timestamp", how="left")

    for col in weather_cols:
        merged[col] = merged[col].interpolate(limit_direction="both")
        merged[col] = merged[col].ffill().bfill()

    return merged


def _add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    ts = pd.to_datetime(df["timestamp"], utc=True)

    df["hour"] = ts.dt.hour
    df["day_of_week"] = ts.dt.dayofweek
    df["day_of_month"] = ts.dt.day
    df["month"] = ts.dt.month
    df["day_of_year"] = ts.dt.dayofyear
    df["week_of_year"] = ts.dt.isocalendar().week.astype(int)
    df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype(int)

    return df


def _add_load_features(df: pd.DataFrame, lags: Iterable[int], rolling_windows: Iterable[int]) -> pd.DataFrame:
    df = df.copy()

    for lag in lags:
        df[f"lag_{lag}"] = df["value"].shift(lag)

    for window in rolling_windows:
        df[f"roll_mean_{window}"] = df["value"].rolling(window).mean()
        df[f"roll_std_{window}"] = df["value"].rolling(window).std()

    return df


def _add_weather_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    weather_cols = [
        c
        for c in ["temperature", "humidity", "pressure", "clouds", "wind_speed", "rain_1h", "snow_1h"]
        if c in df.columns and df[c].notna().any()
    ]

    for col in weather_cols:
        for lag in [1, 3, 6, 24]:
            df[f"{col}_lag_{lag}"] = df[col].shift(lag)

    if "temperature" in weather_cols:
        df["cooling_degree"] = (df["temperature"] - 18.0).clip(lower=0)
        df["heating_degree"] = (18.0 - df["temperature"]).clip(lower=0)
        df["temp_roll_mean_6"] = df["temperature"].rolling(6).mean()
        df["temp_roll_mean_24"] = df["temperature"].rolling(24).mean()

    if "humidity" in weather_cols:
        df["humidity_roll_mean_6"] = df["humidity"].rolling(6).mean()

    if "wind_speed" in weather_cols:
        df["wind_roll_mean_6"] = df["wind_speed"].rolling(6).mean()

    return df


def _drop_all_nan_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    drop_cols = [c for c in df.columns if c != "timestamp" and df[c].isna().all()]
    if drop_cols:
        df = df.drop(columns=drop_cols)
    return df


def build_global_short_term_hourly_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    df = _add_time_features(df)
    df = _add_load_features(
        df,
        lags=[1, 2, 3, 6, 12, 24, 48, 72, 168],
        rolling_windows=[3, 6, 12, 24, 168],
    )
    df = _add_weather_features(df)
    df = _drop_all_nan_columns(df)

    df[BASE_TARGET_COL] = df["value"].shift(-1)

    df = df.dropna().reset_index(drop=True)
    feature_cols = [c for c in df.columns if c not in ["timestamp", BASE_TARGET_COL]]

    return df, feature_cols


def build_global_long_term_hourly_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    df = _add_time_features(df)
    df = _add_load_features(
        df,
        lags=[1, 3, 6, 12, 24, 48, 72, 96, 168],
        rolling_windows=[6, 12, 24, 48, 72, 168],
    )
    df = _add_weather_features(df)
    df = _drop_all_nan_columns(df)

    df[BASE_TARGET_COL] = df["value"].shift(-1)

    df = df.dropna().reset_index(drop=True)
    feature_cols = [c for c in df.columns if c not in ["timestamp", BASE_TARGET_COL]]

    return df, feature_cols