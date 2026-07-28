"""LiteLLM gateway client (D-010) — ALL LLM calls route through here.

OpenAI-compatible: points the `openai` SDK at the in-cluster LiteLLM proxy.
Gateway model names (not raw Bedrock ids) are used: `bedrock-claude`, `bedrock-haiku`.
Cost is computed from returned token usage against a price table (D-026);
LiteLLM also returns per-call cost in the `x-litellm-response-cost` header.
"""
from __future__ import annotations

import os

from openai import OpenAI

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm.default.svc.cluster.local:4000")
LITELLM_API_KEY = os.environ.get("LITELLM_API_KEY", "sk-noauth")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "bedrock-claude")
ROUTER_MODEL = os.environ.get("ROUTER_MODEL", "bedrock-haiku")

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=f"{LITELLM_URL.rstrip('/')}/v1", api_key=LITELLM_API_KEY, timeout=120, max_retries=1)
    return _client


def bedrock_tools_to_openai(tool_defs: list[dict]) -> list[dict]:
    """Convert Bedrock toolSpec definitions to OpenAI function-tool format."""
    out = []
    for t in tool_defs:
        spec = t["toolSpec"]
        out.append({
            "type": "function",
            "function": {
                "name": spec["name"],
                "description": spec.get("description", ""),
                "parameters": spec["inputSchema"]["json"],
            },
        })
    return out


# Price table keyed by GATEWAY model name (config-driven pricing lives in the
# LiteLLM gateway; this mirrors it for the app-side per-model/session rollup, D-026).
PRICING = {
    "bedrock-claude": {"input": 3.00, "output": 15.00, "label": "Claude Sonnet 4.6"},
    "bedrock-haiku": {"input": 0.80, "output": 4.00, "label": "Claude Haiku 4.5"},
    "bedrock-opus": {"input": 15.00, "output": 75.00, "label": "Claude Opus 4.1"},
    "bedrock-nova-pro": {"input": 0.80, "output": 3.20, "label": "Amazon Nova Pro"},
    "neuron-qwen3": {"input": 0.00, "output": 0.00, "label": "Qwen3-8B (self-hosted)"},
}

# Map the UI's chat-model selection to a gateway model name registered in LiteLLM.
# STRICT: a selection with no mapping returns None so the caller errors out rather
# than silently serving a different model (user-trust invariant: selected == served).
# An empty/absent selection falls back to the default CHAT_MODEL.
UI_MODEL_MAP = {
    "qwen3": "neuron-qwen3",
    "claude-sonnet-4.6": "bedrock-claude",
    "claude-haiku-4.5": "bedrock-haiku",
    "claude-opus-4.1": "bedrock-opus",
    "nova-pro": "bedrock-nova-pro",
}


def resolve_model(ui_model):
    """Resolve a UI chat-model selection to a gateway model name.

    Returns CHAT_MODEL when no model is requested; returns None when a model IS
    requested but is not registered — the caller MUST surface an error and never
    substitute a different model.
    """
    sel = (ui_model or "").strip()
    if not sel:
        return CHAT_MODEL
    return UI_MODEL_MAP.get(sel)

LAMBDA_PER_REQUEST = 0.0000002
DYNAMODB_PER_RCU = 0.00000025
API_GW_PER_REQUEST = 0.0000035


def calc_cost(model: str, input_tokens: int, output_tokens: int, tool_calls: int) -> dict:
    pricing = PRICING.get(model, {"input": 3.0, "output": 15.0, "label": model})
    llm_usd = (input_tokens / 1_000_000 * pricing["input"]) + (output_tokens / 1_000_000 * pricing["output"])
    infra_usd = tool_calls * (LAMBDA_PER_REQUEST + DYNAMODB_PER_RCU * 2) + API_GW_PER_REQUEST
    return {
        "llm": {"model": model, "label": pricing["label"], "input_tokens": input_tokens, "output_tokens": output_tokens, "usd": round(llm_usd, 6)},
        "infra": {"tool_calls": tool_calls, "usd": round(infra_usd, 8)},
        "total_usd": round(llm_usd + infra_usd, 6),
    }
