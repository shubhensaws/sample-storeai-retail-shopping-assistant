"""
Typed state for the StoreAI orchestrator.

Implements the directed conversation funnel — the monotonic stage FSM
(GREET -> DISCOVER -> BROWSE -> SHORTLIST -> COMMIT -> HANDOFF -> CLOSED)
defined by the Stage enum below and advanced in app/stage_fsm.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class Stage(str, Enum):
    """Funnel stages — monotonic forward, no backward walks past SHORTLIST."""

    GREET = "greet"
    DISCOVER = "discover"
    BROWSE = "browse"
    SHORTLIST = "shortlist"
    COMMIT_TRYON = "commit_tryon"
    COMMIT_CART = "commit_cart"
    HANDOFF_TRYON = "handoff_tryon"
    HANDOFF_CART_OR_CHECKOUT = "handoff_cart_or_checkout"
    CLOSED = "closed"


Mode = Literal["standard", "booth_shopping", "booth_tryon"]
IntentKind = Literal[
    "browse",
    "refine",
    "pick",
    "add_to_cart",
    "try_on",
    "checkout",
    "auth",
    "size_rec",
    "chitchat",
    "unknown",
]


@dataclass
class TurnInput:
    text: str
    image_ref: str | None = None
    audio_ref: str | None = None


@dataclass
class Product:
    product_id: str
    name: str
    brand: str = ""
    price: float = 0.0
    category: str = ""
    image_url: str = ""


@dataclass
class Intent:
    kind: IntentKind
    entities: dict[str, Any] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class PlanStep:
    specialist: str
    goal: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class TryonJob:
    job_id: str
    product_id: str
    customer_id: str
    status: Literal["queued", "running", "done", "failed"] = "queued"


class ConvState(TypedDict, total=False):
    """Conversation state. Persisted via the DynamoDB checkpointer."""

    # Perception
    messages: Annotated[list[BaseMessage], add_messages]
    turn_input: TurnInput

    # Identity / mode
    session_id: str
    customer_id: str | None
    customer_name: str | None
    mode: Mode

    # Funnel (see §4)
    stage: Stage
    shortlist: list[Product]
    discover_clarifications: int

    # Memory
    short_term: list[dict]
    long_term: list[dict]
    last_products: list[Product]
    pending_intent: Intent | None
    pending_tryons: list[TryonJob]

    # Planning
    intent: Intent | None
    plan: list[PlanStep]

    # Safety
    guardrail_flags: list[str]

    # Telemetry
    session_cost: dict[str, float]
    model_id: str

    # VTON engine selection (from frontend each turn)
    vton_engine: str
    vton_steps: int
    vton_cfg: float

    # Conversation history (passed from frontend each turn)
    history: list[dict]

    # Internal (per-turn, not persisted across sessions)
    _last_reply: str
    _tool_results: list[dict]


def initial_state(session_id: str, mode: Mode = "standard") -> ConvState:
    """Fresh state for a new session — always starts at GREET."""
    return ConvState(
        messages=[],
        turn_input=TurnInput(text=""),
        session_id=session_id,
        customer_id=None,
        customer_name=None,
        mode=mode,
        stage=Stage.GREET,
        shortlist=[],
        discover_clarifications=0,
        short_term=[],
        long_term=[],
        last_products=[],
        pending_intent=None,
        pending_tryons=[],
        intent=None,
        plan=[],
        guardrail_flags=[],
        session_cost={"llm": 0.0, "tools": 0.0, "vton": 0.0},
    )
