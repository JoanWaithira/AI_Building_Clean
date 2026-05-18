from sqlalchemy import Column, DateTime, Float, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class _ForecastBase:
    id = Column(Integer, primary_key=True, index=True)
    meter = Column(String, index=True)
    meter_type = Column(String)
    forecast_type = Column(String, index=True)
    forecast_timestamp = Column(DateTime(timezone=True), index=True)
    run_time = Column(DateTime(timezone=True), index=True)
    job_run_id = Column(String, index=True)
    created_at = Column(DateTime(timezone=True))


class ForecastShort(_ForecastBase, Base):
    __tablename__ = "forecasts_short"
    __table_args__ = {"schema": "public"}

    model_scope = Column(String, index=True)
    model_name = Column(String)
    predicted_value = Column(Float)


class ForecastLong(_ForecastBase, Base):
    __tablename__ = "forecasts_long"
    __table_args__ = {"schema": "public"}

    model_scope = Column(String, index=True)
    model_name = Column(String)
    predicted_value = Column(Float)


class CombinedForecast(_ForecastBase, Base):
    __tablename__ = "combined_forecasts"
    __table_args__ = {"schema": "public"}

    local_predicted_value = Column(Float)
    global_predicted_value = Column(Float)
    combined_value = Column(Float)
    local_weight = Column(Float)
    global_weight = Column(Float)
    local_model_name = Column(String)
    global_model_name = Column(String)
    blend_method = Column(String)


class _UnifiedForecastBase:
    id = Column(Integer, primary_key=True, index=True)
    circuit_id = Column(String, index=True)
    forecast_timestamp = Column(DateTime(timezone=True), index=True)
    forecast_value = Column(Float)
    step_ahead = Column(Integer)
    generated_at = Column(DateTime(timezone=True), index=True)
    model_type = Column(String)
    model_version = Column(String)
    resolution = Column(String)


class _ForecastPanelLocalBase:
    id = Column(Integer, primary_key=True, index=True)
    circuit_id = Column(String, index=True)
    forecast_timestamp = Column(DateTime(timezone=True), index=True)
    forecast_value = Column(Float)
    step_ahead = Column(Integer)
    generated_at = Column(DateTime(timezone=True), index=True)
    model_type = Column(String)
    model_version = Column(String)
    resolution = Column(String)


class ForecastShortTerm(_ForecastPanelLocalBase, Base):
    __tablename__ = "forecast_short_term"
    __table_args__ = {"schema": "public"}


class ForecastLongTerm(_ForecastPanelLocalBase, Base):
    __tablename__ = "forecast_long_term"
    __table_args__ = {"schema": "public"}

    confidence_lower = Column(Float, nullable=True)
    confidence_upper = Column(Float, nullable=True)


class ForecastGlobal(Base):
    __tablename__ = "forecast_global"
    __table_args__ = {"schema": "public"}

    id = Column(Integer, primary_key=True, index=True)
    forecast_timestamp = Column(DateTime(timezone=True), index=True)
    global_prediction = Column(Float)
    step_ahead = Column(Integer)
    generated_at = Column(DateTime(timezone=True), index=True)
    model_version = Column(String)
    resolution = Column(String)


class UnifiedLocalShortTerm(_UnifiedForecastBase, Base):
    __tablename__ = "unified_local_short_term"
    __table_args__ = {"schema": "public"}


class UnifiedLocalLongTerm(_UnifiedForecastBase, Base):
    __tablename__ = "unified_local_long_term"
    __table_args__ = {"schema": "public"}


class UnifiedGlobalShortTerm(_UnifiedForecastBase, Base):
    __tablename__ = "unified_global_short_term"
    __table_args__ = {"schema": "public"}


class UnifiedGlobalLongTerm(_UnifiedForecastBase, Base):
    __tablename__ = "unified_global_long_term"
    __table_args__ = {"schema": "public"}
