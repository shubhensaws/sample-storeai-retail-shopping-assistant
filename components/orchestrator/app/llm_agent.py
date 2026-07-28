"""
LLM-powered conversational agent — the brain of the StoreAI orchestrator.

Uses Claude Sonnet 4.6 via Bedrock converse API with a rich system prompt
and 16 tools. The stage FSM is a soft signal (informs the prompt), not a gate.

Performance tuning:
- Haiku for intent classification (200ms) — avoids redundant Sonnet call
- Reduced history to last 6 turns (enough for context, less input tokens)
- maxTokens capped at 1024 for most turns (product displays rarely exceed 500)
- temperature 0.5 for more deterministic (faster) responses
- Tool loop capped at 5 iterations (prevents runaway chains)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from .gateway_client import get_backend
from .prompts import build_system_prompt
from .state import ConvState

logger = logging.getLogger(__name__)

_region = os.environ.get("AWS_REGION", "us-east-1")
_bedrock = None
MODEL_ID = os.environ.get("CHAT_MODEL", "us.anthropic.claude-sonnet-4-6")

TOOL_DEFS = [
    {"toolSpec": {"name": "search_products",
        "description": "Search the product catalog. IMPORTANT: For gender-ambiguous categories (tshirts, hoodies, jackets, jeans, shorts, sweaters), you MUST ask the customer 'men's or women's?' BEFORE calling this tool, then pass the gender filter. Gender-specific categories (dresses/skirts/leggings/blouses/crop tops = women's; polos/chinos = men's) and unisex categories (sneakers/boots/sandals) can be searched directly. Category values: mens_tshirt, mens_polo, mens_shirt, mens_hoodie, mens_jacket, mens_sweater, mens_jeans, mens_chinos, mens_shorts, mens_joggers, womens_tshirt, womens_blouse, womens_croptop, womens_hoodie, womens_cardigan, womens_jeans, womens_skirt, womens_shorts, womens_leggings, womens_dress, sneakers, running_shoes, boots, sandals. Synonyms: pants→jeans/chinos, top→tshirt/blouse, shoes→sneakers/running_shoes.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Search text (partial name, style, occasion)"},
            "category": {"type": "string", "description": "Product category (see list above). Use gender-prefixed categories for best results (e.g., mens_tshirt, womens_hoodie)"},
            "brand": {"type": "string", "description": "Brand filter"},
            "gender": {"type": "string", "description": "REQUIRED for ambiguous categories. Values: 'men' or 'women'. Ask the customer first if not specified."},
            "min_price": {"type": "string", "description": "Minimum price"},
            "max_price": {"type": "string", "description": "Maximum price"},
            "size": {"type": "string", "description": "Size filter (XS, S, M, L, XL)"}}}}}},
    {"toolSpec": {"name": "get_product_details",
        "description": "Get full details for a specific product including all sizes, colors, description, and stock.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "product_id": {"type": "string", "description": "Product ID (PROD-XXX)"}},
            "required": ["product_id"]}}}},
    {"toolSpec": {"name": "get_customer_profile",
        "description": "Look up a customer by phone number, email, or customer_id. Returns profile with name, preferences, and photo status.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "phone": {"type": "string", "description": "Phone number (flexible format)"},
            "email": {"type": "string", "description": "Email address"},
            "customer_id": {"type": "string", "description": "Customer ID (CUST-XXX)"}}}}}},
    {"toolSpec": {"name": "register_customer",
        "description": "Register a new customer. Only needs name and phone. Returns the generated customer_id. After registration, call get_customer_profile to sign them in.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "first_name": {"type": "string", "description": "Customer's name"},
            "last_name": {"type": "string", "description": "Optional last name (can be empty)"},
            "phone": {"type": "string", "description": "Phone number"}},
            "required": ["first_name", "phone"]}}}},
    {"toolSpec": {"name": "add_to_cart",
        "description": "Add a product to the customer's cart. Size is MANDATORY — never call without a size. Auto-removes from try-on room if the item was there.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "product_id": {"type": "string"},
            "size": {"type": "string", "description": "Size (XS, S, M, L, XL) — REQUIRED"},
            "quantity": {"type": "number", "description": "Quantity (default 1)"}},
            "required": ["customer_id", "product_id", "size"]}}}},
    {"toolSpec": {"name": "remove_from_cart",
        "description": "Remove an item from cart. Requires cart_item_id from get_cart results.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "cart_item_id": {"type": "string"}},
            "required": ["customer_id", "cart_item_id"]}}}},
    {"toolSpec": {"name": "get_cart",
        "description": "Get the customer's cart contents with items, sizes, quantities, and subtotal.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}}, "required": ["customer_id"]}}}},
    {"toolSpec": {"name": "checkout",
        "description": "Checkout the cart. Handles validation: warns if try-on room has items, confirms skip if needed. Use confirm_skip_tryon=true to proceed without moving try-on items.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"},
            "payment_method": {"type": "string", "description": "Use 'demo'"},
            "confirm_skip_tryon": {"type": "boolean", "description": "Set true to skip moving try-on items to cart"}},
            "required": ["customer_id"]}}}},
    {"toolSpec": {"name": "add_to_tryon_room",
        "description": "Add a product to the try-on room. No size needed. Items must be moved to cart (with size) before checkout.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "product_id": {"type": "string"},
            "source": {"type": "string", "description": "Source: 'tryon' or 'cart'"}},
            "required": ["customer_id", "product_id"]}}}},
    {"toolSpec": {"name": "get_tryon_room",
        "description": "Get items in the customer's try-on room.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}}, "required": ["customer_id"]}}}},
    {"toolSpec": {"name": "remove_from_tryon_room",
        "description": "Remove an item from the try-on room by product_id.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "product_id": {"type": "string"}},
            "required": ["customer_id", "product_id"]}}}},
    {"toolSpec": {"name": "virtual_tryon",
        "description": "Generate a virtual try-on image showing how a product looks on the customer. Requires customer photo uploaded first. Returns deferred=true (image generates async, ~30s) or result_url.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "product_id": {"type": "string"}},
            "required": ["customer_id", "product_id"]}}}},
    {"toolSpec": {"name": "check_photo",
        "description": "Check if the customer has uploaded a photo for virtual try-on.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}}, "required": ["customer_id"]}}}},
    {"toolSpec": {"name": "recommend_size",
        "description": "Recommend clothing size. First tries photo-based body measurement (automatic). If that fails (returns photo_measurement_failed), ask the customer for their height and gender, then call again with height_cm and gender. Convert: 1 foot=30.48cm, 1 inch=2.54cm, 1m=100cm.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"}, "product_id": {"type": "string"},
            "height_cm": {"type": "number", "description": "Height in cm. Only needed if photo measurement failed."},
            "gender": {"type": "string", "description": "'men' or 'women'. Only needed if photo measurement failed."}},
            "required": ["customer_id", "product_id"]}}}},
    {"toolSpec": {"name": "get_order_history",
        "description": "Get customer's order history. Optionally filter by date range or product/brand.",
        "inputSchema": {"json": {"type": "object", "properties": {
            "customer_id": {"type": "string"},
            "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
            "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"}},
            "required": ["customer_id"]}}}},
    {"toolSpec": {"name": "get_booth_queue",
        "description": "Get the booth queue — customers waiting for the try-on station. Returns list sorted by arrival time.",
        "inputSchema": {"json": {"type": "object", "properties": {}}}}},
]


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=_region)
    return _bedrock


def _exec_tool(name: str, args: dict[str, Any]) -> str:
    """Execute a tool via the MCP backend (Lambda or local mock)."""
    backend = get_backend()
    result = backend.call(name, args)
    if result.error:
        return json.dumps({"error": result.error})
    return json.dumps(result.result, default=str)


# Cost + gateway client are centralized in llm_client (D-010 / D-026).
# Re-exported here for backward-compat with main.py's streaming path.
from .llm_client import (  # noqa: E402
    PRICING as BEDROCK_PRICING,
    calc_cost as _calc_cost,
    client as _gateway_client,
    CHAT_MODEL as GATEWAY_CHAT_MODEL,
    bedrock_tools_to_openai,
)


def run_agent(state: ConvState) -> tuple[str, list[dict]]:
    """Run the conversational LLM agent with a tool-use loop via the LiteLLM gateway.

    Returns (reply_text, tool_results_collected).
    """
    text = state.get("turn_input").text if state.get("turn_input") else ""
    system = build_system_prompt(state)

    # OpenAI-format messages: system + trimmed history + current turn
    messages: list[dict] = [{"role": "system", "content": system}]
    history = state.get("history", [])
    for h in history[-12:]:
        role = h.get("role", "user")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": text.strip() or "hello"})

    tool_results_collected: list[dict] = []
    total_input_tokens = 0
    total_output_tokens = 0

    # Filter tools by mode — booth shopping station has no try-on tools
    mode = state.get("mode", "standard")
    if mode == "booth_shopping":
        blocked_tools = {"virtual_tryon", "check_photo", "recommend_size"}
        active_defs = [t for t in TOOL_DEFS if t["toolSpec"]["name"] not in blocked_tools]
    else:
        active_defs = TOOL_DEFS
    tools = bedrock_tools_to_openai(active_defs)

    # Cap at 5 tool iterations (most turns need 1-2)
    for _ in range(5):
        try:
            resp = _gateway_client().chat.completions.create(
                model=GATEWAY_CHAT_MODEL,
                messages=messages,
                tools=tools,
                max_tokens=1024,
                temperature=0.5,
            )
        except Exception as e:
            logger.exception("Gateway chat completion failed")
            return f"I'm having trouble right now. Could you try again? ({e})", tool_results_collected

        usage = resp.usage
        if usage:
            total_input_tokens += usage.prompt_tokens or 0
            total_output_tokens += usage.completion_tokens or 0

        msg = resp.choices[0].message
        if not msg.tool_calls:
            reply = msg.content or ""
            cost = _calc_cost(GATEWAY_CHAT_MODEL, total_input_tokens, total_output_tokens, len(tool_results_collected))
            tool_results_collected.append({"tool": "_cost", "result": cost})
            return reply, tool_results_collected

        # Echo the assistant tool-call turn back into the message list
        messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        })
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                tool_input = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                tool_input = {}
            logger.info("Tool call: %s(%s)", tool_name, json.dumps(tool_input)[:200])
            result_str = _exec_tool(tool_name, tool_input)
            logger.info("Tool result: %s → %s", tool_name, result_str[:200])
            tool_results_collected.append({"tool": tool_name, "input": tool_input, "result": result_str})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result_str})

    logger.warning("Tool loop exhausted (5 iterations)")
    return "I need a moment — that involved several steps. Could you try again?", tool_results_collected
