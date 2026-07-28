"""
Stage transition function for the directed funnel.

Forward-only. Rules are deterministic — they depend on `state.intent`, the
set of tool results from the current turn, and a small number of flags
(e.g., discover_clarifications). Never walks backward past SHORTLIST.
"""
from __future__ import annotations

from typing import Any

from .state import ConvState, Intent, Stage

# Max number of clarifying questions the agent may ask in DISCOVER before
# forcing a pivot to BROWSE. Keeps the funnel moving.
DISCOVER_CLARIFICATION_CAP = 2


def next_stage(
    state: ConvState,
    intent: Intent | None,
    tool_results: list[dict[str, Any]] | None = None,
) -> Stage:
    """Decide the next stage. Pure function — no side effects.

    Ordering matters: commitment wins over browsing, hand-off wins over commit.
    """
    tool_results = tool_results or []
    current = state.get("stage", Stage.GREET)

    # Hand-off short-circuits: once a deferred VTON is kicked off or checkout
    # completes, the chat loop closes.
    if _has_tryon_handoff(tool_results):
        return Stage.HANDOFF_TRYON
    if _has_checkout_complete(tool_results):
        return Stage.HANDOFF_CART_OR_CHECKOUT

    kind = intent.kind if intent else "unknown"

    # Commitment intents route to COMMIT_* regardless of where we were
    # (except terminal/CLOSED).
    if current not in {Stage.HANDOFF_TRYON, Stage.HANDOFF_CART_OR_CHECKOUT, Stage.CLOSED}:
        if kind == "try_on":
            return Stage.COMMIT_TRYON
        if kind == "add_to_cart":
            return Stage.COMMIT_CART
        if kind == "checkout":
            return Stage.COMMIT_CART  # checkout flows through the cart commit stage

    # Forward walk for browsing/discovery flow.
    if current == Stage.GREET:
        if kind in {"chitchat", "unknown"}:
            return Stage.DISCOVER
        # Any concrete product signal jumps to BROWSE.
        return Stage.BROWSE

    if current == Stage.DISCOVER:
        # Cap clarifying questions; force pivot to BROWSE.
        clarifications = state.get("discover_clarifications", 0)
        if clarifications >= DISCOVER_CLARIFICATION_CAP:
            return Stage.BROWSE
        if kind in {"browse", "refine", "pick"} or _has_product_results(tool_results):
            return Stage.BROWSE
        return Stage.DISCOVER  # keep asking

    if current == Stage.BROWSE:
        if kind == "pick" or _user_chose_specific_product(tool_results):
            return Stage.SHORTLIST
        return Stage.BROWSE

    if current == Stage.SHORTLIST:
        # Stay until user commits — don't drop back to BROWSE even if they
        # keep asking questions about the shortlisted items.
        return Stage.SHORTLIST

    if current == Stage.COMMIT_TRYON:
        # Hand-off is triggered by tool_results above; otherwise stay to
        # gather prereqs (sign-in, photo).
        return Stage.COMMIT_TRYON

    if current == Stage.COMMIT_CART:
        # "one more item" is a special re-entry to BROWSE with shortlist kept.
        if kind == "browse" and _cart_add_succeeded(tool_results):
            return Stage.BROWSE
        return Stage.COMMIT_CART

    # Terminal stages.
    return current


def after_handoff_is_closed(stage: Stage) -> bool:
    """HANDOFF_* stages are emitted for exactly one turn, then the session is
    sealed to CLOSED after the composer streams its final message."""
    return stage in {Stage.HANDOFF_TRYON, Stage.HANDOFF_CART_OR_CHECKOUT}


# ---- tool-result predicates (string-matching for now; specialists return
# structured results in the real impl) ----

def _has_tryon_handoff(tool_results: list[dict[str, Any]]) -> bool:
    return any(
        tr.get("tool") == "virtual_tryon" and tr.get("result", {}).get("deferred") is True
        for tr in tool_results
    )


def _has_checkout_complete(tool_results: list[dict[str, Any]]) -> bool:
    return any(
        tr.get("tool") == "checkout" and tr.get("result", {}).get("status") == "confirmed"
        for tr in tool_results
    )


def _has_product_results(tool_results: list[dict[str, Any]]) -> bool:
    return any(
        tr.get("tool") == "search_products"
        and (tr.get("result", {}).get("count", 0) > 0)
        for tr in tool_results
    )


def _user_chose_specific_product(tool_results: list[dict[str, Any]]) -> bool:
    return any(
        tr.get("tool") == "get_product_details" and tr.get("result", {}).get("product_id")
        for tr in tool_results
    )


def _cart_add_succeeded(tool_results: list[dict[str, Any]]) -> bool:
    return any(
        tr.get("tool") == "add_to_cart" and tr.get("result", {}).get("cart_item_id")
        for tr in tool_results
    )
