"""Check forecast DB for elevator data."""
import asyncio, asyncpg, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
os.chdir(os.path.dirname(__file__))

from shared import load_local_env_file, get_forecast_db_config
load_local_env_file()

async def check():
    cfg = get_forecast_db_config()
    conn = await asyncpg.connect(**cfg, timeout=10)

    tables = await conn.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    )
    print("Tables:", [r["table_name"] for r in tables])

    for t in [r["table_name"] for r in tables]:
        cols = await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", t
        )
        col_names = [c["column_name"] for c in cols]
        for mc in ["meter", "circuit_id", "circuit"]:
            if mc in col_names:
                vals = await conn.fetch(f"SELECT DISTINCT {mc} FROM {t} LIMIT 30")
                distinct = [r[mc] for r in vals]
                elev = [v for v in distinct if "elev" in str(v).lower() or "lift" in str(v).lower()]
                if elev:
                    print(f"  ** {t}.{mc} has elevator: {elev}")
                break
    await conn.close()

asyncio.run(check())
