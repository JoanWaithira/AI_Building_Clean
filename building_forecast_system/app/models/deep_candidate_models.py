from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import (
    Input, LSTM, Dense, Dropout,
    Conv1D, MaxPooling1D, BatchNormalization,
)
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.optimizers import Adam


def _compile(model):
    model.compile(optimizer=Adam(learning_rate=1e-3), loss="mse", metrics=["mae"])
    return model


def build_lstm_model(input_shape):
    """Stacked two-layer LSTM. input_shape: (lookback, n_features)."""
    return _compile(Sequential([
        Input(shape=input_shape),
        LSTM(128, return_sequences=True),
        BatchNormalization(),
        Dropout(0.2),
        LSTM(64),
        BatchNormalization(),
        Dropout(0.2),
        Dense(32, activation="relu"),
        Dense(1),
    ]))


def build_cnn_lstm_model(input_shape):
    """Two Conv1D layers → stacked LSTM. input_shape: (lookback, n_features)."""
    return _compile(Sequential([
        Input(shape=input_shape),
        Conv1D(filters=64, kernel_size=3, activation="relu", padding="same"),
        Conv1D(filters=32, kernel_size=3, activation="relu", padding="same"),
        BatchNormalization(),
        MaxPooling1D(pool_size=2),
        LSTM(64, return_sequences=True),
        BatchNormalization(),
        Dropout(0.2),
        LSTM(32),
        BatchNormalization(),
        Dropout(0.2),
        Dense(32, activation="relu"),
        Dense(1),
    ]))


def get_early_stopping():
    return EarlyStopping(
        monitor="val_loss",
        patience=10,
        restore_best_weights=True,
    )
