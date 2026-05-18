@echo off
cd /d C:\building_forecast_system
if not exist logs mkdir logs
C:\building_forecast_system\venv\Scripts\python.exe -m app.pipelines.run_long_inference >> logs\long_inference.log 2>&1
C:\building_forecast_system\venv\Scripts\python.exe -m app.pipelines.run_global_long_inference >> logs\long_inference.log 2>&1