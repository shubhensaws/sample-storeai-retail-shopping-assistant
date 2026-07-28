"""
guardrail_in / guardrail_out nodes.

Plug Bedrock Guardrails or a Llama-Guard / NemoGuard classifier here.
The stubs below are deterministic regex checks so the graph is runnable.
"""
from __future__ import annotations

import re

from ..state import ConvState

_INJECTION = re.compile(
    r"(ignore (all|previous) instructions|you are now a different|system prompt:)",
    re.IGNORECASE,
)
_FABRICATED_TRYON = re.compile(r"\[TRYON_IMG:(?!https://)[^\]]+\]")
_FABRICATED_PROD = re.compile(r"\[IMG:PROD-(?!\d{3,})\w+\]")


def guardrail_in(state: ConvState) -> ConvState:
    flags = list(state.get("guardrail_flags", []))
    turn = state.get("turn_input")
    if turn and _INJECTION.search(turn.text or ""):
        flags.append("prompt_injection")
    return {**state, "guardrail_flags": flags}


def guardrail_out(state: ConvState, reply: str) -> tuple[str, ConvState]:
    """Scrub the composed reply. Returns (safe_reply, updated_state)."""
    flags = list(state.get("guardrail_flags", []))
    if _FABRICATED_TRYON.search(reply):
        flags.append("fabricated_tryon_url")
        reply = _FABRICATED_TRYON.sub("", reply)
    if _FABRICATED_PROD.search(reply):
        flags.append("fabricated_product_id")
        reply = _FABRICATED_PROD.sub("", reply)
    return reply, {**state, "guardrail_flags": flags}
