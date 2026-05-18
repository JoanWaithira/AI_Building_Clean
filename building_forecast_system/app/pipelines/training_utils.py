import numpy as np
import pandas as pd
from xgboost import XGBRegressor


def is_low_quality(series: pd.Series, zero_threshold: float = 0.80) -> bool:
    """
    Returns True for circuits not worth modelling:
    - More than 80 % of readings are zero (e.g. 3d_led, vehiclecharging_2)
    - Near-constant signal (coefficient of variation < 0.01)
    """
    if len(series) == 0:
        return True
    if (series == 0).mean() > zero_threshold:
        return True
    mean_val = series.mean()
    if abs(mean_val) > 1e-6 and (series.std() / abs(mean_val)) < 0.01:
        return True
    return False


def chronological_split(df: pd.DataFrame, target_col: str = "target"):
    """
    Default 80/10/10 chronological split.

    If the validation mean deviates more than 2.5 standard deviations from
    the training mean (distribution shift), falls back to a recent-window
    split using the last 60 % for training so the model focuses on the
    current operating regime.
    """
    n = len(df)
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    train_vals = df[target_col].iloc[:train_end]
    val_vals = df[target_col].iloc[train_end:val_end]

    train_std = train_vals.std()
    if train_std > 1e-6:
        shift = abs(val_vals.mean() - train_vals.mean()) / train_std
        if shift > 2.5:
            print(
                f"  Distribution shift detected (z={shift:.1f}) — "
                "using recent-window split (last 60 % for training)"
            )
            train_end = int(n * 0.6)
            val_end = int(n * 0.9)

    return (
        df.iloc[:train_end].copy(),
        df.iloc[train_end:val_end].copy(),
        df.iloc[val_end:].copy(),
    )


def fit_with_recent_weights(
    model,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame | None = None,
    y_val: pd.Series | None = None,
):
    """Fit with linearly increasing sample weights to favour recent data."""
    sample_weight = np.linspace(1.0, 2.0, len(X_train), dtype=float)
    if isinstance(model, XGBRegressor) and X_val is not None:
        model.fit(
            X_train, y_train,
            sample_weight=sample_weight,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )
    else:
        try:
            model.fit(X_train, y_train, sample_weight=sample_weight)
        except TypeError:
            model.fit(X_train, y_train)
