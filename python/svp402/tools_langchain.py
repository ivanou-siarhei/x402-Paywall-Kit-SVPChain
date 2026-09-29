"""LangChain tool: pay_and_fetch(url, max_amount).

Wires SvpPayingClient into LangChain agents (cf. SVP docs agents/langchain-agent.md).
Requires the `langchain` extra: pip install svp402[langchain].
"""
from __future__ import annotations

from typing import Any


def _is_base_units(s: str) -> bool:
    return str(s).isdigit()


def make_pay_and_fetch_tool(client, tool_name: str = "pay_and_fetch"):
    """Build a StructuredTool around an SvpPayingClient instance.

    The agent calls pay_and_fetch(url, max_amount) — max_amount is a per-call
    override in base units (e.g. "10000"); client budgets still apply.
    Returns response JSON (or {"_status", "_body"} envelope for non-JSON).
    """
    try:
        from langchain_core.tools import StructuredTool
        from pydantic import BaseModel, Field
    except ImportError as e:
        raise ImportError("pip install svp402[langchain] to use the LangChain tool") from e

    class PayAndFetchInput(BaseModel):
        url: str = Field(description="Full URL of the paid x402 resource (GET)")
        max_amount: str = Field(
            default="",
            description="Optional per-call cap in base token units; must cover the 402 price",
        )

    def _run(url: str, max_amount: str = "") -> Any:
        # max_amount (base units, 6 dec) is an extra agent-side cap:
        # effective cap = min(client.max_per_call, max_amount). Client budgets apply.
        original = client.max_per_call
        if max_amount and _is_base_units(max_amount):
            try:
                narrowed = int(max_amount) / 10**6
                if narrowed < float(original):
                    client.max_per_call = str(narrowed)
            except Exception:
                pass
        try:
            status, _headers, body = client.get(url)
        finally:
            client.max_per_call = original
        if isinstance(body, (dict, list)):
            return body
        return {"_status": status, "_body": body}

    return StructuredTool.from_function(
        func=_run,
        name=tool_name,
        description=("Fetch a URL behind an x402 paywall. Pays automatically within "
                     "the client's budgets and returns the JSON response. "
                     "Input: url to GET, optional max_amount cap in base units."),
        args_schema=PayAndFetchInput,
    )
