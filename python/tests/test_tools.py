import asyncio

import pytest
from eth_account import Account

from svp402.client import SvpPayingClient
from svp402.tools_langchain import make_pay_and_fetch_tool
from svp402.tools_mcp import create_mcp_server

USDV = "0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951"
PAY_TO = "0x1111111111111111111111111111111111111111"


def v1_402():
    return {"x402Version": 1, "accepts": [{
        "scheme": "exact", "network": "svp-testnet", "maxAmountRequired": "10000",
        "resource": "/api/price", "payTo": PAY_TO, "maxTimeoutSeconds": 60,
        "asset": USDV, "extra": {"assetTransferMethod": "eip3009"}}]}


def paying_client():
    def transport(method, url, headers, body):
        if not (headers or {}).get("PAYMENT-SIGNATURE"):
            return 402, {}, v1_402()
        return 200, {}, {"data": {"price": 7}}

    return SvpPayingClient(signer=Account.create(), transport=transport)


def test_langchain_tool_pays_and_returns_json():
    tool = make_pay_and_fetch_tool(paying_client())
    assert tool.name == "pay_and_fetch"
    out = tool.invoke({"url": "https://api.example.com/api/price"})
    assert out == {"data": {"price": 7}}


def test_langchain_tool_max_amount_narrows_cap():
    def transport_402(method, url, headers, body):
        return 402, {}, v1_402()

    c = SvpPayingClient(signer=Account.create(), transport=transport_402)
    tool = make_pay_and_fetch_tool(c)
    with pytest.raises(ValueError, match="exceeds max_per_call"):
        tool.invoke({"url": "https://api.example.com/api/price", "max_amount": "100"})


def test_mcp_server_exposes_pay_and_fetch():
    mcp = create_mcp_server(paying_client())

    async def go():
        tools = await mcp.list_tools()
        names = [t.name for t in tools]
        assert "pay_and_fetch" in names
        res = await mcp.call_tool("pay_and_fetch", {"url": "https://api.example.com/api/price"})
        assert res is not None

    asyncio.run(go())
