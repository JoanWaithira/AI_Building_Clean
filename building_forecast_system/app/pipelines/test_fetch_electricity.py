from pprint import pprint
from app.clients.gate_api import GateAPIClient


def run():
    client = GateAPIClient()

    data = client.get_electricity_data(
        meter="BuildingMain",
        meter_type="Power"
    )

    print("Response type:", type(data))
    print("Number of top-level items:", len(data))

    pprint(data[:1])


if __name__ == "__main__":
    run()