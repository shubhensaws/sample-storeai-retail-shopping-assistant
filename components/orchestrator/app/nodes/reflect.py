"""reflect node — advances stage based on intent + tool results."""
from __future__ import annotations

from ..stage_fsm import next_stage
from ..state import ConvState, Stage


def reflect(state: ConvState, tool_results: list[dict]) -> ConvState:
    current = state.get("stage", Stage.GREET)
    intent = state.get("intent")
    new_stage = next_stage(state, intent, tool_results)

    updates = {"stage": new_stage}

    # Increment clarifications counter while we stay in DISCOVER.
    if current == Stage.DISCOVER and new_stage == Stage.DISCOVER:
        updates["discover_clarifications"] = state.get("discover_clarifications", 0) + 1

    return {**state, **updates}
