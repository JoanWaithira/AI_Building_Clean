@echo off
cd /d C:\building_forecast_system
if not exist logs mkdir logs
C:\building_forecast_system\venv\Scripts\python.exe -m app.pipelines.run_retraining_cycle >> logs\retraining_cycle.log 2>&1