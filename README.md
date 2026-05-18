# Gate Building AI

[![DOI](https://zenodo.org/badge/1242172693.svg)](https://doi.org/10.5281/zenodo.20266995)

An intelligent smart building Energy Digital Twin developed for real-time monitoring, visualisation, forecasting, and AI-assisted building management.

This project was developed as part of the MSc thesis:

**“Integrating Sensor Data and Energy Forecasting into Digital Twins for Smart Building Management”**  
University of Twente – Faculty of Geo-information Science and Earth Observation (ITC)

## Overview

Gate Building AI integrates real-time building sensor monitoring, energy forecasting pipelines, 3D digital twin visualisation, AI-powered building interaction, PostgREST database APIs, fault detection workflows, and room-level environmental monitoring.

## Features

- Real-time electricity, temperature, humidity, and CO₂ monitoring
- CesiumJS-based 3D digital twin visualisation
- Room and floor navigation
- Heatmap visualisation
- Short-term and long-term energy forecasting
- AI chatbot for querying building data and controlling the digital twin
- Fault detection for HVAC, electricity, solar, battery, and indoor air quality systems

## Tech Stack

- ReactJS
- CesiumJS
- Python
- PostgreSQL
- PostgREST
- Docker
- APScheduler
- XGBoost
- Random Forest
- Extra Trees
- LSTM
- CNN-LSTM
- ARIMA

## Repository Structure

```text
backend/                    Backend services
building_forecast_system/   Forecasting pipelines
mcpserver/                  MCP tools and AI integration
my-building/                Frontend application
.github/workflows/          CI/CD workflows

