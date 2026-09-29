import base64
import json

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data

from svp402.client import (
    SvpPayingClient, parse_402, resource_hash_for, CHAIN_ID,
)

USDV = "0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951"
USDC = "0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489"
PAY_TO = "0x1111111111111111111111111111111111111111"
SETTLEMENT = "0x00000000000000000000000000000000000000A9"


def b64e(o):
    return base64.b64encode(json.dumps(o).encode()).decode()


def v1_402(asset, amount, extra):
    return {"x402Version": 1, "accepts": [{
        "scheme": "exact", "network": "svp-testnet", "maxAmountRequired": amount,
        "resource": "/api/price", "payTo": PAY_TO, "maxTimeoutSeconds": 60,
        "asset": asset, "extra": extra}]}


def test_usdv_eip3009_pays_and_retries():
    payer = Account.create()
    seen = []

    def transport(method, url, headers, body):
        seen.append(headers or {})
        if len(seen) == 1:
            return 402, {}, v1_402(USDV, "10000", {"assetTransferMethod": "eip3009"})
        return 200, {}, {"data": {"price": 1}}

    c = SvpPayingClient(signer=payer, transport=transport)
    status, _, body = c.get("https://api.example.com/api/price")
    assert status == 200 and body == {"data": {"price": 1}}
    sent = json.loads(base64.b64decode(seen[1]["PAYMENT-SIGNATURE"]).decode())
    auth = sent["payload"]["authorization"]
    assert auth["from"] == payer.address and auth["value"] == "10000"
    msg = encode_typed_data(full_message={
        "types": {"EIP712Domain": [
            {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "TransferWithAuthorization": [
            {"name": "from", "type": "address"}, {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"}]},
        "domain": {"name": "VanToken", "version": "1.2.0", "chainId": CHAIN_ID, "verifyingContract": USDV},
        "primaryType": "TransferWithAuthorization",
        "message": {**auth, "value": int(auth["value"]),
                    "validAfter": int(auth["validAfter"]), "validBefore": int(auth["validBefore"])},
    })
    assert Account.recover_message(msg, signature=sent["payload"]["signature"]) == payer.address


def test_usdc_settlement_uses_x_payment():
    payer = Account.create()
    seen = []

    def transport(method, url, headers, body):
        seen.append(headers or {})
        if len(seen) == 1:
            return 402, {}, v1_402(USDC, "10000",
                                   {"assetTransferMethod": "settlement", "settlement": SETTLEMENT})
        return 200, {}, {"ok": True}

    c = SvpPayingClient(signer=payer, transport=transport)
    status, _, _ = c.get("https://api.example.com/api/data")
    assert status == 200
    assert "X-PAYMENT" in seen[1]


def test_max_per_call_enforced_before_sign():
    payer = Account.create()

    def transport(method, url, headers, body):
        return 402, {}, v1_402(USDV, "999999999", {})

    c = SvpPayingClient(signer=payer, max_per_call="0.05", transport=transport)
    with pytest.raises(ValueError, match="exceeds max_per_call"):
        c.get("https://api.example.com/api/x")


def test_daily_budget_enforced():
    payer = Account.create()
    calls = []

    def transport(method, url, headers, body):
        calls.append(1)
        if not (headers or {}).get("PAYMENT-SIGNATURE"):
            return 402, {}, v1_402(USDV, "10000", {})
        return 200, {}, {}

    c = SvpPayingClient(signer=payer, daily_budget="0.015", transport=transport)
    c.get("https://api.example.com/api/x")
    with pytest.raises(ValueError, match="exceeds daily_budget"):
        c.get("https://api.example.com/api/x")
    assert len(calls) == 3


def test_parse_402_v2_header():
    v2 = {"x402Version": 2, "accepts": [{"scheme": "exact", "network": "eip155:2517",
          "amount": "500", "asset": USDC, "payTo": PAY_TO, "maxTimeoutSeconds": 60, "extra": {}}]}
    req = parse_402(402, {"payment-required": b64e(v2)}, None)
    assert req["amount"] == "500" and req["v"] == 2


def test_resource_hash_matches_ts_client():
    # keccak("GET /api/price") — must equal @svp402/client + server computation
    assert resource_hash_for("GET", "https://api.example.com/api/price?x=1") == \
        "0xa92981978b949f943cd2da1b28a9ea8f383dfd313972e68dcef27a8918102975"
