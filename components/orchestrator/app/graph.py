"""
LangGraph StateGraph for the StoreAI orchestrator.

Node order (cognitive loop):
  perceive → guardrail_in → memory_read → intent_router
  → supervisor → reflect → guardrail_out → END

The graph is compiled once at module load and reused across requests.
"""
from __future__ import annotations

import json

from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from .composer import compose
from .llm_agent import run_agent
from .nodes.guardrails import guardrail_in, guardrail_out
from .nodes.perceive import perceive
from .nodes.reflect import reflect
from .stage_fsm import next_stage
from .state import ConvState, Intent, Stage


# ── node functions ────────────────────────────────────────────────────────────

def _perceive(state: ConvState) -> ConvState:
    return perceive(state)


def _guardrail_in(state: ConvState) -> ConvState:
    return guardrail_in(state)


def _memory_read(state: ConvState) -> ConvState:
    """Inject short-term + long-term memory context.

    Short-term: last shown products, so the LLM can reference items by number
    even several turns later.

    Long-term: for signed-in customers, semantically recall salient facts from
    past sessions (via the memory-mcp / S3 Vectors backend) using the current
    message as the query. Best-effort — never blocks the turn on a memory error.
    """
    updates: dict = {}

    last_products = state.get("last_products", [])
    if last_products:
        product_memory = [
            f"{i}. {p.name} [{p.product_id}] by {p.brand} — ${p.price}"
            for i, p in enumerate(last_products[:5], 1)
        ]
        updates["short_term"] = [{"type": "last_shown_products", "items": product_memory}]

    cid = state.get("customer_id")
    if cid:
        try:
            from .gateway_client import get_backend
            query = state.get("turn_input").text if state.get("turn_input") else ""
            result = get_backend().call("read_memory", {"customer_id": cid, "query": query, "k": 3})
            if not result.error:
                memories = result.result.get("memories", [])
                if memories:
                    updates["long_term"] = memories
        except Exception:  # noqa: BLE001 — memory is best-effort context
            pass

    return {**state, **updates} if updates else state


def _intent_router(state: ConvState) -> ConvState:
    """Classify user intent via fast keyword pre-filter then LLM Haiku fallback.

    The classified intent informs the system prompt's stage context and helps
    the LLM agent understand what the user is trying to do.
    """
    from .nodes.intent_router import classify
    text = state.get("turn_input").text if state.get("turn_input") else ""
    intent = classify(text)
    return {**state, "intent": intent}


def _supervisor(state: ConvState) -> ConvState:
    """Run the LLM agent with tool-use. This is the brain of the orchestrator."""
    reply, tool_results = run_agent(state)

    # Post-process reply through the stage-aware composer.
    stage = state.get("stage", Stage.GREET)
    composed = compose(state, reply)

    # Append the assistant message.
    msgs = list(state.get("messages", []))
    msgs.append(AIMessage(content=composed))

    # Format tool_results for the frontend (v1 format: {tool, result} where result is a JSON string)
    formatted_results = [
        {"tool": tr["tool"], "result": tr["result"] if isinstance(tr["result"], str) else json.dumps(tr["result"])}
        for tr in tool_results
    ]

    # Extract customer sign-in and product results from tool results (auto-propagate to state)
    updates: dict = {"messages": msgs, "_last_reply": composed, "_tool_results": formatted_results}
    for tr in tool_results:
        if tr["tool"] == "get_customer_profile":
            result = tr["result"]
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    result = {}
            if result.get("customer_id") and not result.get("error"):
                updates["customer_id"] = result["customer_id"]
                name = result.get("first_name", "")
                if result.get("last_name"):
                    name = f"{name} {result['last_name']}"
                updates["customer_name"] = name.strip()
        elif tr["tool"] == "register_customer":
            result = tr["result"]
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    result = {}
            if result.get("customer_id"):
                updates["customer_id"] = result["customer_id"]
        elif tr["tool"] == "search_products":
            result = tr["result"]
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    result = {}
            products_raw = result.get("products", [])
            if products_raw:
                from .state import Product
                products = []
                for p in products_raw[:5]:
                    products.append(Product(
                        product_id=p.get("product_id", ""),
                        name=p.get("name", ""),
                        brand=p.get("brand", ""),
                        price=float(p.get("price", 0)),
                        category=p.get("category", ""),
                        image_url=p.get("image_url", ""),
                    ))
                updates["last_products"] = products

    return {**state, **updates}


def _infer_intent_from_tools(tool_results: list[dict]) -> Intent | None:
    """Deterministic intent inference from which tools the LLM called."""
    tools_called = {tr.get("tool") for tr in tool_results}
    if "checkout" in tools_called:
        return Intent(kind="checkout")
    if "virtual_tryon" in tools_called:
        return Intent(kind="try_on")
    if "add_to_cart" in tools_called:
        return Intent(kind="add_to_cart")
    if "recommend_size" in tools_called:
        return Intent(kind="size_rec")
    if "get_customer_profile" in tools_called or "register_customer" in tools_called:
        return Intent(kind="auth")
    if "get_product_details" in tools_called:
        return Intent(kind="pick")
    if "search_products" in tools_called:
        return Intent(kind="browse")
    if not tools_called:
        return Intent(kind="chitchat")
    return Intent(kind="browse")


def _reflect(state: ConvState) -> ConvState:
    """Advance the stage FSM based on what the LLM did this turn.

    Runs AFTER the response is composed — stage update affects NEXT turn's prompt.
    """
    tool_results = state.get("_tool_results", [])
    intent = _infer_intent_from_tools(tool_results)

    # Parse JSON string results for FSM predicates
    parsed_results = []
    for tr in tool_results:
        result = tr.get("result", "")
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                result = {}
        parsed_results.append({"tool": tr.get("tool"), "result": result})

    current_stage = state.get("stage", Stage.GREET)
    new_stage = next_stage(state, intent, parsed_results)

    updates: dict = {"stage": new_stage, "intent": intent}
    if current_stage == Stage.DISCOVER and new_stage == Stage.DISCOVER:
        updates["discover_clarifications"] = state.get("discover_clarifications", 0) + 1

    return {**state, **updates}


def _guardrail_out(state: ConvState) -> ConvState:
    reply = state.get("_last_reply", "")
    safe_reply, new_state = guardrail_out(state, reply)
    # Patch the last AIMessage if the guardrail scrubbed anything.
    if safe_reply != reply:
        msgs = list(new_state.get("messages", []))
        if msgs and isinstance(msgs[-1], AIMessage):
            msgs[-1] = AIMessage(content=safe_reply)
        new_state = {**new_state, "messages": msgs, "_last_reply": safe_reply}
    return new_state


# ── routing ───────────────────────────────────────────────────────────────────

def _route_after_guardrail_in(state: ConvState) -> str:
    """Block the turn if a prompt-injection flag was raised."""
    if "prompt_injection" in state.get("guardrail_flags", []):
        return "blocked"
    return "continue"


def _blocked(state: ConvState) -> ConvState:
    msgs = list(state.get("messages", []))
    msgs.append(AIMessage(content="I can only help with shopping. How can I assist?"))
    return {**state, "messages": msgs}


# ── graph assembly ────────────────────────────────────────────────────────────

def build_graph(checkpointer=None):
    g = StateGraph(ConvState)

    g.add_node("perceive", _perceive)
    g.add_node("guardrail_in", _guardrail_in)
    g.add_node("memory_read", _memory_read)
    g.add_node("intent_router", _intent_router)
    g.add_node("supervisor", _supervisor)
    g.add_node("reflect", _reflect)
    g.add_node("guardrail_out", _guardrail_out)
    g.add_node("blocked", _blocked)

    g.set_entry_point("perceive")
    g.add_edge("perceive", "guardrail_in")
    g.add_conditional_edges(
        "guardrail_in",
        _route_after_guardrail_in,
        {"continue": "memory_read", "blocked": "blocked"},
    )
    g.add_edge("blocked", END)
    g.add_edge("memory_read", "intent_router")
    g.add_edge("intent_router", "supervisor")
    g.add_edge("supervisor", "reflect")
    g.add_edge("reflect", "guardrail_out")
    g.add_edge("guardrail_out", END)

    cp = checkpointer or MemorySaver()
    return g.compile(checkpointer=cp)


# Module-level compiled graph (reused across Lambda invocations).
graph = build_graph()
