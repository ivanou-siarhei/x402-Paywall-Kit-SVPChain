"""SvpPayingClient — mirrors @svp402/client semantics in Python.

Spec DX goal (§8): client = SvpPayingClient(signer, max_per_call="0.05", daily_budget="2").
"""
from __future__ import annotations

import base64
import datetime
import json
import secrets
from typing import Any, Callable

import httpx
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

CHAIN_ID = 2517

KNOWN_ASSETS: dict[str, dict[str, Any]] = {
    "0x013a61e622e6abfcab64f52d274c3fc0aa37f951": {
        "symbol": "USDV", "decimals": 6, "eip3009": True,
        "eip712": {"name": "VanToken", "version": "1.2.0"},
    },
    "0x732f6ea7afd5edc02e7ba052075dd0780e285489": {
        "symbol": "USDC", "decimals": 6, "eip3009": False},
}

EIP3009_TYPES = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ]
}
SETTLEMENT_TYPES = {
    "PaymentAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "asset", "type": "address"},
        {"name": "amount", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
        {"name": "validBefore", "type": "uint64"},
        {"name": "resourceHash", "type": "bytes32"},
    ]
}


def b64e(obj: Any) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def b64d(s: str) -> Any:
    return json.loads(base64.b64decode(s).decode())


def asset_info(address: str) -> dict[str, Any]:
    return KNOWN_ASSETS.get(address.lower(), {"symbol": "CUSTOM", "decimals": 6, "eip3009": False})


def resource_hash_for(method: str, url: str) -> str:
    u = str(url)
    path = u.split("?")[0]
    if path.startswith("http"):
        from urllib.parse import urlparse
        path = urlparse(path).path
    return "0x" + keccak(f"{method.upper()} {path}".encode()).hex()


def parse_402(status: int, headers: dict, body: Any) -> dict[str, Any]:
    """Normalize v1 JSON body or v2 PAYMENT-REQUIRED header into one requirement dict."""
    hdr = (headers or {}).get("payment-required") or (headers or {}).get("PAYMENT-REQUIRED")
    if hdr:
        v2 = b64d(hdr)
        a = v2["accepts"][0]
        return {"amount": str(a["amount"]), "asset": a["asset"], "payTo": a["payTo"],
                "extra": a.get("extra") or {}, "v": 2, "raw": v2}
    accepts = (body or {}).get("accepts") or []
    if not accepts:
        raise ValueError("unparseable 402: no accepts")
    a = accepts[0]
    return {"amount": str(a["maxAmountRequired"]), "asset": a["asset"], "payTo": a["payTo"],
            "extra": a.get("extra") or {}, "v": 1, "raw": body}


def _sign_typed(signer, domain: dict, types: dict, primary: str, message: dict) -> str:
    msg = encode_typed_data(full_message={
        "types": {"EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ], **types},
        "domain": domain,
        "primaryType": primary,
        "message": message,
    })
    sig = signer.sign_message(msg).signature
    hexsig = sig.hex() if isinstance(sig, bytes) else bytes(sig).hex()
    return "0x" + hexsig  # ethers/viem require 0x-prefixed signatures


class SvpPayingClient:
    """Pays x402 paywalls automatically within budget.

    signer: eth_account Account (has .address and .sign_message).
    max_per_call / daily_budget: human-unit strings, e.g. "0.05" / "2".
    transport: optional callable (method, url, headers, json_body) -> (status, headers, body)
               for tests; defaults to httpx.
    """

    def __init__(self, signer, max_per_call: str = "0.05", daily_budget: str = "2",
                 settlement_address: str | None = None,
                 transport: Callable | None = None):
        if signer is None:
            raise ValueError("signer required")
        self.signer = signer
        self.max_per_call = max_per_call
        self.daily_budget = daily_budget
        self.settlement_address = settlement_address
        self.transport = transport or self._httpx_transport
        self.spent_today = 0
        self.day = datetime.date.today().isoformat()

    @staticmethod
    def _httpx_transport(method, url, headers, json_body):
        with httpx.Client() as c:
            r = c.request(method, url, headers=headers or {}, json=json_body)
            try:
                body = r.json()
            except Exception:
                body = None
            return r.status_code, dict(r.headers), body

    def _roll_day(self):
        today = datetime.date.today().isoformat()
        if today != self.day:
            self.day = today
            self.spent_today = 0

    def _to_base(self, human: str, decimals: int) -> int:
        whole, _, frac = str(human).partition(".")
        return int(whole) * 10**decimals + int((frac + "0" * decimals)[:decimals] or 0)

    def _sign_eip3009(self, req: dict) -> tuple[str, dict]:
        info = asset_info(req["asset"])
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        auth = {
            "from": self.signer.address, "to": req["payTo"], "value": int(req["amount"]),
            "validAfter": now - 10, "validBefore": now + 55,
            "nonce": "0x" + secrets.token_hex(32),
        }
        sig = _sign_typed(self.signer,
                          {"name": info["eip712"]["name"], "version": info["eip712"]["version"],
                           "chainId": CHAIN_ID, "verifyingContract": req["asset"]},
                          EIP3009_TYPES, "TransferWithAuthorization", auth)
        auth_out = {**auth, "value": str(auth["value"]),
                    "validAfter": str(auth["validAfter"]), "validBefore": str(auth["validBefore"])}
        return sig, auth_out

    def _sign_settlement(self, req: dict, method: str, url: str, settlement: str) -> tuple[str, dict]:
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        auth = {
            "from": self.signer.address, "to": req["payTo"], "asset": req["asset"],
            "amount": int(req["amount"]), "nonce": "0x" + secrets.token_hex(32),
            "validBefore": now + 300, "resourceHash": resource_hash_for(method, url),
        }
        sig = _sign_typed(self.signer,
                          {"name": "Svp402Settlement", "version": "1",
                           "chainId": CHAIN_ID, "verifyingContract": settlement},
                          SETTLEMENT_TYPES, "PaymentAuthorization", auth)
        auth_out = {**auth, "amount": str(auth["amount"])}
        return sig, auth_out

    def fetch(self, url: str, method: str = "GET", headers: dict | None = None,
              json_body: Any = None):
        status, rheaders, body = self.transport(method, url, headers, json_body)
        if status != 402:
            return status, rheaders, body
        req = parse_402(status, rheaders, body)
        return self._pay_and_retry(url, method, headers, json_body, req)

    def get(self, url: str, headers: dict | None = None):
        return self.fetch(url, "GET", headers)

    def _pay_and_retry(self, url, method, headers, json_body, req: dict):
        self._roll_day()
        info = asset_info(req["asset"])
        amount = int(req["amount"])
        if amount > self._to_base(self.max_per_call, info["decimals"]):
            raise ValueError(f"payment {req['amount']} exceeds max_per_call "
                             f"{self.max_per_call} {info['symbol']}")
        if self.spent_today + amount > self._to_base(self.daily_budget, info["decimals"]):
            raise ValueError(f"payment exceeds daily_budget {self.daily_budget} {info['symbol']}")
        transfer = (req["extra"] or {}).get("assetTransferMethod") or \
            ("eip3009" if info["eip3009"] else "settlement")
        if transfer == "eip3009":
            sig, auth = self._sign_eip3009(req)
            payload = {"x402Version": 2, "accepted": {"scheme": "exact"},
                       "payload": {"signature": sig, "authorization": auth}}
            header = "PAYMENT-SIGNATURE"
        else:
            settlement = (req["extra"] or {}).get("settlement") or self.settlement_address
            if not settlement:
                raise ValueError("settlement address unknown: pass settlement_address or use USDV")
            sig, auth = self._sign_settlement(req, method, url, settlement)
            payload = {"x402Version": 1, "scheme": "exact", "network": "svp-testnet",
                       "payload": {"signature": sig, "authorization": auth}}
            header = "X-PAYMENT"
        self.spent_today += amount
        h = dict(headers or {})
        h[header] = b64e(payload)
        status, rheaders, body = self.transport(method, url, h, json_body)
        if status == 402:
            raise ValueError("payment rejected: " + json.dumps(body)[:200])
        return status, rheaders, body
