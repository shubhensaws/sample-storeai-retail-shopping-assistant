"""
Stage-aware response composer — soft nudges only.

Lightweight post-processor that:
  1. Appends a gentle forward-prompt if the LLM didn't already ask a next-step question.
  2. Emits hand-off markers for frontend state transitions.

Never blocks, overrides, or rewrites the LLM's response. Trust the LLM
with a rich prompt to stay on topic.
"""
from __future__ import annotations

import re

from .state import ConvState, Stage

FORWARD_PROMPTS = {
    Stage.BROWSE: "\n\nAny of these catch your eye? I can show you more details, help you try something on virtually, or add it to your cart.",
    Stage.SHORTLIST: "\n\nWould you like to try it on to see how it looks, or shall I add it to your cart?",
    Stage.COMMIT_CART: "\n\nAnything else you'd like to look at, or shall we head to checkout?",
}

HANDOFF_MARKERS = {
    Stage.HANDOFF_TRYON: "\n\n[HANDOFF:TRYON]",
    Stage.HANDOFF_CART_OR_CHECKOUT: "\n\n[HANDOFF:CHECKOUT_COMPLETE]",
}

_HAS_QUESTION = re.compile(r"\?\s*$")
_HAS_NEXT_STEP = re.compile(
    r"(try.*(on|it)|add to cart|narrow|checkout|which one|pick|size|recommend)",
    re.IGNORECASE,
)


def compose(state: ConvState, llm_reply: str) -> str:
    """Soft post-processing. Never blocks or rewrites the LLM response."""
    stage = state.get("stage", Stage.GREET)
    reply = llm_reply.rstrip()

    if not reply:
        return reply

    # Append soft nudge only if LLM didn't already include a next-step question
    if stage in FORWARD_PROMPTS and not _ends_with_next_step(reply):
        reply += FORWARD_PROMPTS[stage]

    # Hand-off markers (structural signals for the frontend)
    if stage in HANDOFF_MARKERS:
        reply += HANDOFF_MARKERS[stage]

    return reply


def _ends_with_next_step(text: str) -> bool:
    tail = text[-200:]
    return bool(_HAS_QUESTION.search(tail) and _HAS_NEXT_STEP.search(tail))
