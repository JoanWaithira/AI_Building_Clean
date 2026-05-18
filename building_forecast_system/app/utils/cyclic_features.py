import numpy as np
import pandas as pd


def add_cyclic_encoding(df: pd.DataFrame, hour_col: str = "hour", dow_col: str = "day_of_week", month_col: str | None = "month") -> pd.DataFrame:
    """
    Replace raw integer period columns with sin/cos pairs so the model
    sees no discontinuity at period boundaries (hour 23 → 0, Sun → Mon, Dec → Jan).

    month_col is optional — pass None to skip (sequence models don't need it).
    """
    df = df.copy()
    df["hour_sin"] = np.sin(2 * np.pi * df[hour_col] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df[hour_col] / 24)
    df["dow_sin"] = np.sin(2 * np.pi * df[dow_col] / 7)
    df["dow_cos"] = np.cos(2 * np.pi * df[dow_col] / 7)
    if month_col is not None:
        df["month_sin"] = np.sin(2 * np.pi * df[month_col] / 12)
        df["month_cos"] = np.cos(2 * np.pi * df[month_col] / 12)
    return df
