"""Server side for Python: paywall for FastAPI/Starlette (mirrors @svp402/server).

Usage (FastAPI):
    from svp402.server import paywall_dependency

    guard = paywall_dependency(price="0.01", asset="USDV", payTo=PAY_TO,
                               facilitator_url="http://127.0.0.1:3001")

    @app.get("/api/price")
    async def price(receipt=Depends(guard)):
        return {"data": {...}, "payment": receipt}
"""
from __future__ import annotations

import base64
import json
from typing import Any

import httpx

from .client import KNOWN_ASSETS
from eth_utils import to_checksum_address

try:
    from fastapi import Header as _Header
    from fastapi import Request as _Request
    _FASTAPI = True
except ImportError:  # fastapi is optional; paywall_dependency raises a clear error
    _Header = _Request = None  # type: ignore
    _FASTAPI = False

SVP_LEGACY_NETWORK = "svp-testnet"
CAIP2 = "eip155:2517"


def _b64e(obj: Any) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def _b64d(s: str) -> Any:
    return json.loads(base64.b64decode(s).decode())


def _to_base(amount: str, decimals: int) -> str:
    whole, _, frac = str(amount).partition(".")
    return str(int(whole) * 10**decimals + int((frac + "0" * decimals)[:decimals] or 0))


def build_requirements(price: str, asset: str, pay_to: str, resource: str,
                       settlement_address: str | None = None,
                       description: str = "", max_timeout: int = 60) -> dict:
    info = KNOWN_ASSETS.get(asset.lower(), {"symbol": "CUSTOM", "decimals": 6, "eip3009": False})
    # resolve by symbol too
    for addr, meta in KNOWN_ASSETS.items():
        if meta["symbol"] == asset.upper():
            info = {**meta, "address": to_checksum_address(addr)}
            break
    else:
        info = {**info, "address": to_checksum_address(asset) if asset.startswith("0x") else asset}
    amount = _to_base(price, info["decimals"])
    extra = {"assetTransferMethod": "eip3009", **info.get("eip712", {})} if info["eip3009"] \
        else {"assetTransferMethod": "settlement", "settlement": settlement_address}
    v1 = {"x402Version": 1, "error": "Payment required to access this resource",
          "accepts": [{"scheme": "exact", "network": SVP_LEGACY_NETWORK,
                       "maxAmountRequired": amount, "resource": resource,
                       "description": description or f"Access to {resource}",
                       "mimeType": "application/json", "payTo": pay_to,
                       "maxTimeoutSeconds": max_timeout, "asset": info["address"], "extra": extra}]}
    payment_requirements = {"scheme": "exact", "network": CAIP2, "amount": amount,
                            "asset": info["address"], "payTo": pay_to,
                            "maxTimeoutSeconds": max_timeout, "extra": extra}
    v2 = {"x402Version": 2, "error": "PAYMENT-SIGNATURE header is required",
          "resource": {"url": resource, "description": description, "mimeType": "application/json"},
          "accepts": [payment_requirements]}
    return {"v1": v1, "v2": v2, "payment_requirements": payment_requirements}


def _parse_payment(headers) -> dict | None:
    raw = headers.get("x-payment") or headers.get("X-PAYMENT") \
        or headers.get("payment-signature") or headers.get("PAYMENT-SIGNATURE")
    if not raw:
        return None
    try:
        p = _b64d(raw)
    except Exception:
        return None
    if "scheme" in p and "payload" in p:
        return {"accepted": {"scheme": p["scheme"]}, "payload": p["payload"]}
    if "accepted" in p and "payload" in p:
        return p
    return None


def paywall_dependency(price: str, asset: str, pay_to: str,
                       facilitator_url: str = "http://127.0.0.1:3001",
                       settle_mode: str = "sync", settlement_address: str | None = None,
                       description: str = ""):
    """Return a FastAPI dependency that enforces payment and yields the receipt."""
    if not _FASTAPI:
        raise ImportError("pip install fastapi to use the server paywall")

    # The dependency uses Request for the resource path.
    async def guard_with_request(request: _Request,
                                 x_payment: str | None = _Header(default=None),
                                 payment_signature: str | None = _Header(default=None)):
        return await _guard_headers(
            {"x-payment": x_payment, "payment-signature": payment_signature},
            resource=request.url.path,
            price=price, asset=asset, pay_to=pay_to, facilitator_url=facilitator_url,
            settle_mode=settle_mode, settlement_address=settlement_address,
            description=description)

    return guard_with_request


async def _guard_headers(headers: dict, resource: str, price: str, asset: str, pay_to: str,
                         facilitator_url: str, settle_mode: str,
                         settlement_address: str | None, description: str) -> dict | None:
    from fastapi import HTTPException

    built = build_requirements(price, asset, pay_to, resource, settlement_address, description)
    parsed = _parse_payment({k: v for k, v in headers.items() if v})
    if not parsed:
        raise _402(built)
    async with httpx.AsyncClient() as c:
        v = (await c.post(f"{facilitator_url}/verify",
                          json={"x402Version": 2, "paymentPayload": parsed,
                                "paymentRequirements": built["payment_requirements"]})).json()
    if not v.get("isValid"):
        raise _402(built, f"Invalid payment: {v.get('invalidReason')}")
    receipt = None
    if settle_mode == "sync":
        async with httpx.AsyncClient() as c:
            receipt = (await c.post(f"{facilitator_url}/settle",
                                    json={"x402Version": 2, "paymentPayload": parsed,
                                          "paymentRequirements": built["payment_requirements"]})).json()
        if not receipt.get("success"):
            raise _402(built, f"Settlement failed: {receipt.get('error')}")
    return {"txHash": receipt.get("txHash"), "networkId": receipt.get("networkId")} if receipt else None


def _402(built: dict, error: str | None = None):
    from fastapi import HTTPException
    body = dict(built["v1"])
    if error:
        body["error"] = error
    raise HTTPException(status_code=402, detail=body,
                        headers={"PAYMENT-REQUIRED": _b64e(built["v2"])})
