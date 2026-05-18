import os
from fastapi import APIRouter, Query, HTTPException
import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse

router = APIRouter()

# Load DB credentials from environment variables
DB_HOST = os.getenv("FORECAST_DB_HOST")
DB_PORT = os.getenv("FORECAST_DB_PORT", "5432")
DB_NAME = os.getenv("FORECAST_DB_NAME")
DB_USER = os.getenv("FORECAST_DB_USER")
DB_PASSWORD = os.getenv("FORECAST_DB_PASSWORD")

async def get_pg_conn():
    return await asyncpg.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
    )

@router.get("/pg-forecasts/local/short")
async def get_pg_local_short_forecast(circuit_id: str = Query(...)):
    query = """
        SELECT * FROM unified_local_short_term WHERE circuit_id = $1 ORDER BY forecast_timestamp ASC
    """
    try:
        conn = await get_pg_conn()
        rows = await conn.fetch(query, circuit_id)
        await conn.close()
        data = [dict(row) for row in rows]
        return {"data": data, "source": "postgresql"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
