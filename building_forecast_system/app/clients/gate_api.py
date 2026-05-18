import requests
from app.config import SOURCE_API_BASE_URL, SOURCE_API_KEY


class GateAPIClient:
    def __init__(self):
        if not SOURCE_API_BASE_URL:
            raise ValueError("SOURCE_API_BASE_URL is missing in .env")
        if not SOURCE_API_KEY:
            raise ValueError("SOURCE_API_KEY is missing in .env")

        self.base_url = SOURCE_API_BASE_URL.rstrip("/")
        self.headers = {
            "X-API-Key": SOURCE_API_KEY
        }

    def get_electricity_meta(self):
        url = f"{self.base_url}/electricity/meta"
        response = requests.get(url, headers=self.headers, timeout=60)
        response.raise_for_status()
        return response.json()

    def get_electricity_data(self, meter: str, meter_type: str, start_date: str = None, end_date: str = None):
        url = f"{self.base_url}/electricity/data"

        params = {
            "meter": meter,
            "meter_type": meter_type
        }

        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date

        response = requests.get(url, headers=self.headers, params=params, timeout=60)
        response.raise_for_status()
        return response.json()
    
