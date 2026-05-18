import numpy as np
import pandas as pd

from app.utils.cyclic_features import add_cyclic_encoding

# ---------------------------------------------------------------------------
# Short-term sequence features  (5-min resolution, lookback=96 → 8 h)
# Captures intra-day load shape.  Month omitted — irrelevant at 5-min scale.
# ---------------------------------------------------------------------------
SEQUENCE_FEATURE_COLS = ["value", "hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend"]

# ---------------------------------------------------------------------------
# Long-term sequence features  (hourly resolution, lookback=168 → 1 week)
# Adds month_sin/cos so the model is aware of seasonal position, and keeps
# a full weekly window so it can learn Mon-Sun load cycles end-to-end.
# ---------------------------------------------------------------------------
LONG_SEQUENCE_FEATURE_COLS = [
    "value",
    "hour_sin", "hour_cos",     # intra-day cycle (24 h)
    "dow_sin", "dow_cos",       # intra-week cycle (7 days)
    "month_sin", "month_cos",   # seasonal cycle (12 months)
    "is_weekend",
]

LONG_LOOKBACK = 24 * 7  # 168 h — one full week of hourly history


def _add_sequence_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """Short-term cyclic time features (no month encoding)."""
    df = df.copy()
    ts = pd.to_datetime(df["timestamp"], utc=True)
    df["hour"] = ts.dt.hour
    df["day_of_week"] = ts.dt.dayofweek
    df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype("float32")
    df = add_cyclic_encoding(df, month_col=None)
    return df


def _add_long_sequence_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """Long-term cyclic time features (includes month encoding)."""
    df = df.copy()
    ts = pd.to_datetime(df["timestamp"], utc=True)
    df["hour"] = ts.dt.hour
    df["day_of_week"] = ts.dt.dayofweek
    df["month"] = ts.dt.month
    df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype("float32")
    df = add_cyclic_encoding(df)
    return df


def build_sequence_dataset(
    df: pd.DataFrame,
    target_col: str = "value",
    lookback: int = 96,
    horizon: int = 1,
):
    """
    Builds multivariate sequences for deep learning models.

    Each input window includes the load value plus cyclic time features so the
    model knows *when* in the day/week each step falls — the same context that
    tabular models receive via engineered features.

    X shape: (samples, lookback, n_features)   where n_features = len(SEQUENCE_FEATURE_COLS)
    y shape: (samples,)

    lookback=96 covers a full 8-hour window at 5-min resolution (was 24 = 2 h),
    giving the model enough history to see intra-day load patterns.
    """
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = _add_sequence_time_features(df)

    feature_matrix = df[SEQUENCE_FEATURE_COLS].values.astype("float32")
    target_values = df[target_col].values.astype("float32")

    X, y = [], []

    for i in range(lookback, len(feature_matrix) - horizon + 1):
        X.append(feature_matrix[i - lookback:i])
        y.append(target_values[i + horizon - 1])

    return np.array(X), np.array(y)


def build_long_sequence_dataset(
    df: pd.DataFrame,
    target_col: str = "value",
    lookback: int = LONG_LOOKBACK,
    horizon: int = 1,
):
    """
    Builds multivariate sequences for long-term (hourly) deep learning models.

    Designed for hourly-resampled data.  Uses LONG_SEQUENCE_FEATURE_COLS which
    adds month_sin/cos (seasonal awareness) on top of the short-term features.

    X shape: (samples, lookback, n_features)   n_features = len(LONG_SEQUENCE_FEATURE_COLS)
    y shape: (samples,)

    lookback=168 gives the model a full week of hourly context so it can
    learn the complete Mon-Sun load cycle before making a prediction.
    """
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = _add_long_sequence_time_features(df)

    feature_matrix = df[LONG_SEQUENCE_FEATURE_COLS].values.astype("float32")
    target_values = df[target_col].values.astype("float32")

    X, y = [], []

    for i in range(lookback, len(feature_matrix) - horizon + 1):
        X.append(feature_matrix[i - lookback:i])
        y.append(target_values[i + horizon - 1])

    return np.array(X), np.array(y)


def build_long_multivariate_sequence_row(
    work_df: pd.DataFrame,
    lookback: int,
) -> np.ndarray:
    """
    Build a single (1, lookback, n_features) input tensor for long-term recursive inference.

    Uses LONG_SEQUENCE_FEATURE_COLS (includes month_sin/cos).
    work_df must have 'timestamp' and 'value' columns.
    Zero-padded at the front if fewer than lookback rows are available.
    """
    recent = work_df[["timestamp", "value"]].tail(lookback).copy()
    recent = _add_long_sequence_time_features(recent)

    seq = recent[LONG_SEQUENCE_FEATURE_COLS].values.astype("float32")

    if len(seq) < lookback:
        pad = np.zeros((lookback - len(seq), seq.shape[1]), dtype="float32")
        seq = np.vstack([pad, seq])

    return np.expand_dims(seq, axis=0)  # (1, lookback, n_features)


def build_multivariate_sequence_row(
    work_df: pd.DataFrame,
    lookback: int,
) -> np.ndarray:
    """
    Build a single (1, lookback, n_features) input tensor for recursive inference.

    work_df must have 'timestamp' and 'value' columns.  If fewer than lookback
    rows are available the window is zero-padded at the front.
    """
    recent = work_df[["timestamp", "value"]].tail(lookback).copy()
    recent = _add_sequence_time_features(recent)

    seq = recent[SEQUENCE_FEATURE_COLS].values.astype("float32")

    if len(seq) < lookback:
        pad = np.zeros((lookback - len(seq), seq.shape[1]), dtype="float32")
        seq = np.vstack([pad, seq])

    return np.expand_dims(seq, axis=0)  # (1, lookback, n_features)
