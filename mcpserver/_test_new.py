"""Quick validation of the new mcp-server.py (3 sources, no PostgREST)."""
import sys, os, asyncio

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from shared import (
    load_local_env_file,
    get_supabase_config,
    get_supabase_headers,
    get_realtime_api_config,
    get_forecast_db_config,
)
import httpx

load_local_env_file()


async def test_supabase():
    cfg = get_supabase_config()
    headers = get_supabase_headers()
    url = cfg["url"] + "/rest/v1/"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=headers)
        paths = [p.strip("/") for p in r.json().get("paths", {}).keys() if p != "/"]
        print(f"[Supabase]   OK — {len(paths)} tables: {sorted(set(paths))[:4]}...")


async def test_realtime():
    cfg = get_realtime_api_config()
    headers = {"X-API-Key": cfg["api_key"]}
    url = cfg["base_url"] + "/sensor/data/meta"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=headers)
        body = r.json()
        floors = len(body) if isinstance(body, (list, dict)) else "?"
        print(f"[Real-time]  OK — status={r.status_code}, floors={floors}")


async def test_forecast():
    try:
        import asyncpg
        cfg = get_forecast_db_config()
        conn = await asyncpg.connect(
            host=cfg["host"], port=cfg["port"], database=cfg["database"],
            user=cfg["user"], password=cfg["password"], timeout=10,
        )
        rows = await conn.fetch(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' LIMIT 5"
        )
        await conn.close()
        print(f"[Forecast DB] OK — {len(rows)} tables sample: {[r['table_name'] for r in rows]}")
    except Exception as e:
        print(f"[Forecast DB] SKIP (VPN required): {e}")


async def main():
    await test_supabase()
    await test_realtime()
    await test_forecast()
    print("\nAll done.")


asyncio.run(main())
