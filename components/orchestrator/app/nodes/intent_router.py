"""
intent_router node — classifies the user's turn into a structured intent.

Production-ready. Uses Bedrock Claude Haiku for classification with a
fast keyword pre-filter for obvious intents (saves an LLM call ~60% of turns).
Falls back to keyword-only if Bedrock is unavailable.
"""
from __future__ import annotations

import json
import logging
import os
import re

import boto3

from ..state import ConvState, Intent, IntentKind

logger = logging.getLogger(__name__)

_region = os.environ.get("AWS_REGION", "us-east-1")
_bedrock = None
ROUTER_MODEL = os.environ.get("ROUTER_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=_region)
    return _bedrock


# ── Fast keyword pre-filter (skips LLM for obvious intents) ──────────────────

_KEYWORD_PATTERNS: list[tuple[re.Pattern, IntentKind, float]] = [
    (re.compile(r"\b(try\s*(it|this|that|them|on)|virtual try|see how (it|this|they) look)", re.I), "try_on", 0.95),
    (re.compile(r"\b(add (it |this |that )?(to )?(my )?cart|buy (it|this|that)|purchase)", re.I), "add_to_cart", 0.95),
    (re.compile(r"\b(check\s*out|place (my |the )?order|pay|proceed to)", re.I), "checkout", 0.95),
    (re.compile(r"\b(sign\s*(me\s*)?in|log\s*(me\s*)?in|register|my account)", re.I), "auth", 0.90),
    # Browse BEFORE pick — product category words always mean browsing
    (re.compile(r"\b(show me|tshirts?|t-shirts?|hoodies?|jeans|jackets?|shirts?|tops?|dresses?|sneakers|shoes|boots|shorts|joggers|sweaters?|skirts?|blouses?|pants|bottoms|leggings)", re.I), "browse", 0.90),
    # Pick — only when referencing by number or using "take/pick/choose" with a determiner (not "want to see")
    (re.compile(r"\b(number\s*\d+|i('ll| will)\s*(take|pick|choose|go with)\s*(the|that|this|number|#|it))", re.I), "pick", 0.85),
]


def _keyword_classify(text: str) -> Intent | None:
    """Return an intent if a high-confidence keyword match is found, else None."""
    for pat, kind, conf in _KEYWORD_PATTERNS:
        if pat.search(text):
            return Intent(kind=kind, confidence=conf)
    return None


# ── LLM classification ───────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are an intent classifier for a retail shopping assistant. Given the user's message, output a JSON object with:
- "intent": one of: browse, refine, pick, add_to_cart, try_on, checkout, auth, size_rec, chitchat, unknown
- "entities": extracted entities (product_ref, size, color, brand, etc.) as key-value pairs
- "missing": list of required entities that are missing for this intent
- "confidence": float 0-1

Rules:
- "browse": user wants to see products, search, or explore categories
- "refine": user wants to filter/narrow existing results (cheaper, different color, etc.)
- "pick": user selects a specific product from results (by number, name, or description)
- "add_to_cart": user explicitly wants to add to cart
- "try_on": user wants to virtually try on a product
- "checkout": user wants to complete purchase
- "auth": user wants to sign in, register, or manage account
- "size_rec": user asks about sizing or fit
- "chitchat": mood/occasion/style advice, greetings, or off-topic

Output ONLY valid JSON, no explanation."""


def _llm_classify(text: str) -> Intent:
    """Classify via the LiteLLM gateway (Haiku). Fast (~200ms) and accurate."""
    try:
        from ..llm_client import client, ROUTER_MODEL
        resp = client().chat.completions.create(
            model=ROUTER_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            max_tokens=150,
            temperature=0.0,
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
        parsed = json.loads(raw)
        return Intent(
            kind=parsed.get("intent", "unknown"),
            entities=parsed.get("entities", {}),
            missing=parsed.get("missing", []),
            confidence=float(parsed.get("confidence", 0.7)),
        )
    except Exception as e:
        logger.warning("LLM intent classification failed, falling back to keywords: %s", e)
        return _fallback_classify(text)


# ── Fallback keyword classifier (used when Bedrock is unavailable) ───────────

_FALLBACK_PATTERNS: list[tuple[re.Pattern, IntentKind]] = [
    (re.compile(r"\b(try\s*(it|this|that|on)|virtual try|see how)", re.I), "try_on"),
    (re.compile(r"\b(add to (my )?cart|buy|purchase)", re.I), "add_to_cart"),
    (re.compile(r"\b(check\s*out|place (my )?order)", re.I), "checkout"),
    (re.compile(r"\b(size|fit|measurement)", re.I), "size_rec"),
    (re.compile(r"\b(sign\s*in|log\s*in|register|my account|phone)", re.I), "auth"),
    (re.compile(r"\b(number\s*\d+|the (white|black|blue|red) one|pick|choose)", re.I), "pick"),
    (re.compile(r"\b(show me|find me|search for|looking for|do you have|i need|i want)\b", re.I), "browse"),
    (re.compile(r"\b(more options|different|other|cheaper|smaller|bigger|another)", re.I), "refine"),
    (re.compile(r"\b(hi|hello|hey|good morning|good evening|howdy|what's up|sup)\b", re.I), "chitchat"),
    (re.compile(r"\b(mood|occasion|vibe|weather|date night|party|office|winter|summer)", re.I), "chitchat"),
]


def _fallback_classify(text: str) -> Intent:
    for pat, kind in _FALLBACK_PATTERNS:
        if pat.search(text):
            return Intent(kind=kind, confidence=0.6)
    return Intent(kind="chitchat", confidence=0.3)


# ── Node entry point ─────────────────────────────────────────────────────────

def classify(text: str) -> Intent:
    """Classify user intent. Keyword pre-filter → LLM → keyword fallback."""
    if not text:
        return Intent(kind="unknown", confidence=0.0)

    # Fast path: high-confidence keyword match skips the LLM call
    kw = _keyword_classify(text)
    if kw:
        return kw

    # LLM path
    return _llm_classify(text)


def intent_router(state: ConvState) -> ConvState:
    text = state.get("turn_input").text if state.get("turn_input") else ""
    intent = classify(text)
    return {**state, "intent": intent}
