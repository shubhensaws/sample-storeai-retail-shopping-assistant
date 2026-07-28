"""
Thin client for calling MCP tools via the AgentCore Gateway.

In production, this wraps `boto3.client("bedrock-agentcore")` (or the MCP
HTTP interface) with per-agent scoped tokens, so each specialist only has
access to its own subset of tools. Here we provide the interface and a
local mock backend for development.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)

GATEWAY_URL = os.environ.get("AGENTCORE_GATEWAY_URL", "")


@dataclass
class ToolResult:
    tool: str
    result: dict[str, Any]
    error: str | None = None


class MCPBackend(Protocol):
    def call(self, tool: str, arguments: dict[str, Any]) -> ToolResult: ...


class GatewayMCP:
    """Production backend — POSTs MCP tools/call to AgentCore Gateway."""

    def __init__(self, gateway_url: str, scoped_token: str):
        self.gateway_url = gateway_url
        self.scoped_token = scoped_token
        # Lazily import so this module stays importable without boto3.
        import urllib.request

        self._urlopen = urllib.request.urlopen
        self._request_cls = urllib.request.Request

    def call(self, tool: str, arguments: dict[str, Any]) -> ToolResult:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        }
        req = self._request_cls(
            self.gateway_url,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.scoped_token}",
            },
            method="POST",
        )
        try:
            with self._urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
            if "error" in body:
                return ToolResult(tool=tool, result={}, error=body["error"].get("message"))
            content = body.get("result", {}).get("content", [])
            # MCP results are typically [{"type":"text","text":"..."}]
            text = next((c["text"] for c in content if c.get("type") == "text"), "{}")
            try:
                return ToolResult(tool=tool, result=json.loads(text))
            except json.JSONDecodeError:
                return ToolResult(tool=tool, result={"raw": text})
        except Exception as e:
            logger.exception("Gateway MCP call failed for %s", tool)
            return ToolResult(tool=tool, result={}, error=str(e))


class LocalMockMCP:
    """Local/dev backend — calls the deployed MCP Lambdas directly via boto3.
    Falls back to canned responses if Lambda invocation fails."""

    def __init__(self):
        self._lambda = None

    def _get_lambda(self):
        if self._lambda is None:
            import boto3
            self._lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        return self._lambda

    def _invoke_lambda(self, tool: str, arguments: dict[str, Any]) -> ToolResult | None:
        """Try to invoke the real MCP Lambda for this tool."""
        env = os.environ.get("ENV", "dev")
        prefix = f"storeai-{env}"
        TOOL_TO_LAMBDA = {
            "search_products": f"{prefix}-catalog-mcp",
            "get_product_details": f"{prefix}-catalog-mcp",
            "get_recommendations": f"{prefix}-catalog-mcp",
            "get_customer_profile": f"{prefix}-customer-mcp",
            "register_customer": f"{prefix}-customer-mcp",
            "get_order_history": f"{prefix}-customer-mcp",
            "get_booth_queue": f"{prefix}-customer-mcp",
            "get_cart": f"{prefix}-cart-mcp",
            "add_to_cart": f"{prefix}-cart-mcp",
            "remove_from_cart": f"{prefix}-cart-mcp",
            "checkout": f"{prefix}-cart-mcp",
            "get_tryon_room": f"{prefix}-cart-mcp",
            "add_to_tryon_room": f"{prefix}-cart-mcp",
            "remove_from_tryon_room": f"{prefix}-cart-mcp",
            "virtual_tryon": f"{prefix}-tryon-mcp",
            "check_photo": f"{prefix}-tryon-mcp",
            "upload_tryon_photo": f"{prefix}-tryon-mcp",
            "recommend_size": f"{prefix}-size-rec-mcp",
            "get_tryon_results": f"{prefix}-tryon-mcp",
            "tryon_job_status": f"{prefix}-tryon-mcp",
            "read_memory": f"{prefix}-memory-mcp",
            "write_memory": f"{prefix}-memory-mcp",
            "summarize_session": f"{prefix}-memory-mcp",
        }
        func_name = TOOL_TO_LAMBDA.get(tool)
        if not func_name:
            return None
        try:
            client = self._get_lambda()
            payload = json.dumps({"tool": tool, "arguments": arguments})
            resp = client.invoke(FunctionName=func_name, Payload=payload)
            result = json.loads(resp["Payload"].read())
            body = json.loads(result.get("body", "{}")) if isinstance(result.get("body"), str) else result
            return ToolResult(tool=tool, result=body)
        except Exception as e:
            logger.warning("Lambda invoke failed for %s: %s", tool, e)
            return None

    def call(self, tool: str, arguments: dict[str, Any]) -> ToolResult:
        # Virtual try-on is generated OUT OF BAND by the frontend (processTryon ->
        # /virtual_try_on) so the chat turn stays fast. Running the ~38s VTON
        # synchronously here blocks /chat and can exceed the 60s edge/Lambda
        # timeout, surfacing as a generic "encountered an error" to the user.
        # Return deferred immediately; the frontend renders the image shortly after.
        if tool == "virtual_tryon":
            return ToolResult(tool=tool, result={"deferred": True, **arguments})
        # Try real Lambda first
        result = self._invoke_lambda(tool, arguments)
        if result:
            return result
        # Fallback to canned responses
        if tool == "search_products":
            return ToolResult(tool=tool, result={"products": [], "count": 0})
        if tool == "get_product_details":
            return ToolResult(tool=tool, result={"product_id": arguments.get("product_id", ""), "name": "Unknown"})
        if tool == "virtual_tryon":
            return ToolResult(tool=tool, result={"deferred": True, "job_id": "JOB-mock", **arguments})
        if tool == "checkout":
            return ToolResult(tool=tool, result={"status": "confirmed", "order_id": "ORD-MOCK"})
        if tool == "add_to_cart":
            return ToolResult(tool=tool, result={"cart_item_id": "CI-MOCK", "message": "Added"})
        if tool == "get_customer_profile":
            return ToolResult(tool=tool, result={"error": "not found"})
        if tool == "check_photo":
            return ToolResult(tool=tool, result={"has_photo": False})
        return ToolResult(tool=tool, result={"ok": True})


def get_backend() -> MCPBackend:
    """Return the configured backend — Gateway in prod, mock locally."""
    if GATEWAY_URL and os.environ.get("AGENTCORE_TOKEN"):
        return GatewayMCP(GATEWAY_URL, os.environ["AGENTCORE_TOKEN"])
    return LocalMockMCP()
