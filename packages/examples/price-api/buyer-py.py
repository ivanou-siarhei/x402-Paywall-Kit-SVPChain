"""Python buyer agent: buys /api/price within budget (spec §8 DX goal).

Run:  API=http://127.0.0.1:3100 .venv/Scripts/python buyer-py.py
"""
import os
import sys

sys.path.insert(0, "../../../python")
from eth_account import Account  # noqa: E402
from svp402 import SvpPayingClient  # noqa: E402

API = os.environ.get("API", "http://127.0.0.1:3100")
key = os.environ.get("PAYER_KEY") or Account.create().key
client = SvpPayingClient(signer=Account.from_key(key), max_per_call="0.05", daily_budget="2")

status, _, body = client.get(f"{API}/api/price")
print("py-buyer:", status, str(body)[:120])
