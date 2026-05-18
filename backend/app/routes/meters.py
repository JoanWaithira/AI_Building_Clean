import csv
import logging
import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UnifiedLocalLongTerm, UnifiedLocalShortTerm

router = APIRouter(prefix="/meters", tags=["meters"])
logger = logging.getLogger(__name__)


def _get_csv_circuits() -> set[str]:
    """Read unique circuit_ids from CSV files."""
    circuits = set()
    csv_base_dir = Path(
        os.getenv(
            "FORECAST_CSV_DIR",
            str(Path(__file__).resolve().parents[3] / "my-building" / "public" / "floorplans"),
        )
    )
    csv_files = [
        csv_base_dir / "unified_local_short_term.csv",
        csv_base_dir / "unified_local_long_term.csv",
    ]
    
    for csv_file in csv_files:
        if not os.path.exists(csv_file):
            logger.warning(f"CSV file not found: {csv_file}")
            continue
        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    circuit_id = row.get('circuit_id', '').strip()
                    if circuit_id:
                        circuits.add(circuit_id)
        except Exception as e:
            logger.warning(f"Error reading CSV {csv_file}: {e}")
    
    return circuits


@router.get("")
def get_available_meters(db: Session = Depends(get_db)) -> dict[str, list[str]]:
    """Get available meters from all forecast sources the API can serve."""
    db_circuits: set[str] = set()
    try:
        db_circuits = {
            value
            for value in db.execute(select(UnifiedLocalShortTerm.circuit_id).distinct()).scalars().all()
            if value
        }
        db_circuits.update(
            value
            for value in db.execute(select(UnifiedLocalLongTerm.circuit_id).distinct()).scalars().all()
            if value
        )
    except SQLAlchemyError as exc:
        logger.warning(f"Failed to get circuits from database: {exc}")

    csv_circuits: set[str] = set()
    try:
        csv_circuits = _get_csv_circuits()
    except Exception as exc:
        logger.error(f"Failed to get circuits: {exc}")

    all_circuits = db_circuits | csv_circuits
    if all_circuits:
        logger.info(
            "Returning %d circuits (%d database, %d csv)",
            len(all_circuits),
            len(db_circuits),
            len(csv_circuits),
        )
        return {"meters": sorted(all_circuits)}

    raise HTTPException(status_code=500, detail="Failed to fetch meters")
