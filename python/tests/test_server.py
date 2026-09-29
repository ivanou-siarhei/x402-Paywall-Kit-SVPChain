import base64
import json

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from svp402.server import build_requirements, paywall_dependency

PAY_TO = "0x1111111111111111111111111111111111111111"
USDV = "0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951"


def make_app(verify_result):
    import svp402.server as srv

    async def fake_guard_headers(headers, **kw):
        if not (headers.get("x-payment") or headers.get("payment-signature")):
            from fastapi import HTTPException
            built = build_requirements(kw["price"], kw["asset"], kw["pay_to"], kw["resource"])
            raise HTTPException(status_code=402, detail=built["v1"])
        if not verify_result["isValid"]:
            from fastapi import HTTPException
            raise HTTPException(status_code=402, detail="invalid")
        return {"txHash": "0xabc", "networkId": "eip155:2517"}

    srv._guard_headers = fake_guard_headers
    app = FastAPI()
    guard = paywall_dependency(price="0.01", asset="USDV", pay_to=PAY_TO,
                               facilitator_url="http://x")
    received = {}

    @app.get("/api/price")
    async def price(receipt=Depends(guard)):
        received["receipt"] = receipt
        return {"data": {"btc": 1}, "payment": receipt}

    return app, received


def test_no_payment_402():
    app, _ = make_app({"isValid": True})
    r = TestClient(app).get("/api/price")
    assert r.status_code == 402
    assert r.json()["detail"]["accepts"][0]["maxAmountRequired"] == "10000"


def test_paid_passes_with_receipt():
    app, received = make_app({"isValid": True})
    payload = base64.b64encode(json.dumps(
        {"x402Version": 1, "scheme": "exact", "payload": {}}).encode()).decode()
    r = TestClient(app).get("/api/price", headers={"X-PAYMENT": payload})
    assert r.status_code == 200
    assert r.json()["payment"] == {"txHash": "0xabc", "networkId": "eip155:2517"}
    assert received["receipt"]["txHash"] == "0xabc"


def test_build_requirements_usdv_eip3009():
    b = build_requirements("0.01", "USDV", PAY_TO, "/api/price")
    assert b["v1"]["accepts"][0]["asset"] == USDV
    assert b["v1"]["accepts"][0]["extra"]["assetTransferMethod"] == "eip3009"
    assert b["payment_requirements"]["network"] == "eip155:2517"
