"""Temporary test script for validating the three data sources."""
import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from shared import load_local_env_file, get_forecast_db_config, get_realtime_api_config, get_postgrest_base

load_local_env_file()


async def test_forecast_db():
    print("=" * 60)
    print("TEST 1: Gate Forecast PostgreSQL Database")
    print("=" * 60)
    import asyncpg
    cfg = get_forecast_db_config()
    print(f"  Host: {cfg['host']}:{cfg['port']}  DB: {cfg['database']}  User: {cfg['user']}")
    try:
        conn = await asyncpg.connect(
            host=cfg["host"], port=cfg["port"],
            database=cfg["database"], user=cfg["user"],
            password=cfg["password"], timeout=10,
        )
        tables = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        )
        print(f"  Connection OK! Found {len(tables)} table(s):")
        for t in tables:
            print(f"    - {t['table_name']}")

        # Sample first table
        if tables:
            first = tables[0]["table_name"]
            cols = await conn.fetch(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
                first,
            )
            print(f"\n  Schema of '{first}':")
            for c in cols:
                print(f"    {c['column_name']} ({c['data_type']})")

            sample = await conn.fetch(f"SELECT * FROM {first} LIMIT 3")
            print(f"\n  Sample rows from '{first}' ({len(sample)} rows):")
            for row in sample:
                print(f"    {dict(row)}")

        await conn.close()
        print("\n  RESULT: PASS")
    except Exception as e:
        print(f"  Connection FAILED: {e}")
        print("  RESULT: FAIL (requires GATE network / VPN)")


async def test_realtime_api():
    print("\n" + "=" * 60)
    print("TEST 2: Gate Building Real-Time API")
    print("=" * 60)
    import httpx
    cfg = get_realtime_api_config()
    base = cfg["base_url"]
    key = cfg["api_key"]
    print(f"  Base URL: {base}")
    print(f"  API Key: {key[:10]}..." if key else "  API Key: NOT SET")

    headers = {"X-API-Key": key}

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 2a: Sensor metadata
        try:
            resp = await client.get(f"{base}/sensor/data/meta", headers=headers)
            resp.raise_for_status()
            meta = resp.json()
            floors = meta.get("floors", {})
            print(f"  Sensor meta OK — {len(floors)} floor(s): {list(floors.keys())}")
        except Exception as e:
            print(f"  Sensor meta FAILED: {e}")

        # 2b: Live sensor data (floor 0)
        try:
            resp = await client.get(f"{base}/sensor/data/floor_0/", headers=headers)
            resp.raise_for_status()
            data = resp.json()
            print(f"  Floor 0 sensor data OK — {len(data)} room(s) returned")
            if data:
                first_room = data[0] if isinstance(data, list) else data
                print(f"    Sample: {json.dumps(first_room, indent=2, default=str)[:500]}")
        except Exception as e:
            print(f"  Floor 0 sensor data FAILED: {e}")

        # 2c: Electricity metadata
        try:
            resp = await client.get(f"{base}/electricity/meta", headers=headers)
            resp.raise_for_status()
            emeta = resp.json()
            print(f"  Electricity meta OK — {len(emeta)} meter(s)")
        except Exception as e:
            print(f"  Electricity meta FAILED: {e}")

        # 2d: Electricity data sample
        try:
            resp = await client.get(
                f"{base}/electricity/data",
                headers=headers,
                params={"meter": "BuildingMain", "meter_type": "Energy"},
            )
            resp.raise_for_status()
            edata = resp.json()
            print(f"  BuildingMain energy data OK — sample:")
            print(f"    {json.dumps(edata, indent=2, default=str)[:400]}")
        except Exception as e:
            print(f"  Electricity data FAILED: {e}")

        # 2e: Solar metadata
        try:
            resp = await client.get(f"{base}/solar/meta", headers=headers)
            resp.raise_for_status()
            smeta = resp.json()
            print(f"  Solar meta OK — {json.dumps(smeta, default=str)[:300]}")
        except Exception as e:
            print(f"  Solar meta FAILED: {e}")

    print("\n  RESULT: PASS (if no failures above)")


async def test_local_postgrest():
    print("\n" + "=" * 60)
    print("TEST 3: Local PostgREST (duplicated Supabase tables)")
    print("=" * 60)
    import httpx

    for api in ("3000", "3001"):
        base = get_postgrest_base(api)
        print(f"\n  API {api}: {base}")

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{base}/")
                resp.raise_for_status()
                data = resp.json()
                paths = [p.strip("/") for p in data.get("paths", {}).keys() if p != "/"]
                print(f"    OpenAPI OK — {len(paths)} table(s)/view(s):")
                for p in sorted(paths)[:15]:
                    print(f"      - {p}")
                if len(paths) > 15:
                    print(f"      ... and {len(paths) - 15} more")
            except Exception as e:
                print(f"    Connection FAILED: {e}")
                print(f"    (Is PostgREST running on {base}?)")

    print("\n  RESULT: PASS (if PostgREST is running)")


async def main():
    await test_forecast_db()
    await test_realtime_api()
    await test_local_postgrest()
    print("\n" + "=" * 60)
    print("ALL TESTS COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
