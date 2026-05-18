import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.models.deep_candidate_models import (
    build_lstm_model,
    build_cnn_lstm_model,
    get_early_stopping,
)


def split_sequence_data(X, y):
    """
    Chronological split for sequence models.
    No shuffling allowed for time series.

    80% train
    10% validation
    10% test
    """
    n = len(X)

    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    X_train = X[:train_end]
    y_train = y[:train_end]

    X_val = X[train_end:val_end]
    y_val = y[train_end:val_end]

    X_test = X[val_end:]
    y_test = y[val_end:]

    return X_train, y_train, X_val, y_val, X_test, y_test


def evaluate_regression(y_true, y_pred):
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))
    return {"rmse": rmse, "mae": mae}


def train_lstm(X_train, y_train, X_val, y_val, X_test, y_test, epochs: int = 30):
    if len(X_train) == 0 or len(X_val) == 0 or len(X_test) == 0:
        raise ValueError("One of the LSTM datasets is empty.")

    model = build_lstm_model(input_shape=(X_train.shape[1], X_train.shape[2]))

    model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=32,
        callbacks=[get_early_stopping()],
        verbose=0,
    )

    val_pred = model.predict(X_val, verbose=0).flatten()
    test_pred = model.predict(X_test, verbose=0).flatten()

    val_metrics = evaluate_regression(y_val, val_pred)
    test_metrics = evaluate_regression(y_test, test_pred)

    return model, val_metrics, test_metrics, test_pred


def train_cnn_lstm(X_train, y_train, X_val, y_val, X_test, y_test, epochs: int = 30):
    if len(X_train) == 0 or len(X_val) == 0 or len(X_test) == 0:
        raise ValueError("One of the CNN-LSTM datasets is empty.")

    model = build_cnn_lstm_model(input_shape=(X_train.shape[1], X_train.shape[2]))

    model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=32,
        callbacks=[get_early_stopping()],
        verbose=0,
    )

    val_pred = model.predict(X_val, verbose=0).flatten()
    test_pred = model.predict(X_test, verbose=0).flatten()

    val_metrics = evaluate_regression(y_val, val_pred)
    test_metrics = evaluate_regression(y_test, test_pred)

    return model, val_metrics, test_metrics, test_pred