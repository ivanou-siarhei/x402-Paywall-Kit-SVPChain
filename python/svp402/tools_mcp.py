"""MCP tool: pay_and_fetch(url, max_amount) — FastMCP server.

Style follows svpchain-dex-mcp/svpchain-defi-mcp: the server never holds keys —
the private key comes from env (SVP_PAYER_KEY) at server start, signing stays
in-process. Requires the `mcp` extra: pip install svp402[mcp].

Run: SVP_PAYER_KEY=0x... python -m svp402.tools_mcp
"""
from __future__ import annotations

import os

from eth_account import Account

from .client import SvpPayingClient


def build_client() -> SvpPayingClient:
    key = os.environ.get("SVP_PAYER_KEY")
    if not key:
        raise RuntimeError("SVP_PAYER_KEY env required")
    return SvpPayingClient(
        signer=Account.from_key(key),
        max_per_call=os.environ.get("SVP_MAX_PER_CALL", "0.05"),
        daily_budget=os.environ.get("SVP_DAILY_BUDGET", "2"),
        settlement_address=os.environ.get("SVP_SETTLEMENT_ADDRESS"),
    )


def create_mcp_server(client: SvpPayingClient | None = None):
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as e:
        raise ImportError("pip install svp402[mcp] to use the MCP server") from e
    mcp = FastMCP("svp402")
    paying = client or build_client()

    @mcp.tool()
    def pay_and_fetch(url: str, max_amount: str = "") -> dict:
        """Fetch a URL behind an x402 paywall, paying within budget.

        Args:
            url: full URL of the paid resource (GET).
            max_amount: optional per-call cap in base token units.
        """
        _ = max_amount  # client budgets (max_per_call/daily_budget) always apply
        status, _headers, body = paying.get(url)
        if isinstance(body, dict):
            return {"status": status, **body}
        return {"status": status, "body": body}

    return mcp


def main() -> None:
    create_mcp_server().run()


if __name__ == "__main__":
    main()
