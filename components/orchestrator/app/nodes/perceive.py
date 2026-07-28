"""perceive node — normalize the incoming turn."""
from __future__ import annotations

from langchain_core.messages import HumanMessage

from ..state import ConvState, TurnInput


def perceive(state: ConvState) -> ConvState:
    turn = state.get("turn_input") or TurnInput(text="")
    msgs = list(state.get("messages", []))
    if turn.text:
        msgs.append(HumanMessage(content=turn.text))
    return {**state, "messages": msgs}
