@echo off
cd /d C:\building_forecast_system
if not exist logs mkdir logs
C:\building_forecast_system\venv\Scripts\python.exe -m app.pipelines.run_short_inference >> logs\short_inference.log 2>&1
C:\building_forecast_system\venv\Scripts\python.exe -m app.pipelines.run_global_short_inference >> logs\short_inference.log 2>&1