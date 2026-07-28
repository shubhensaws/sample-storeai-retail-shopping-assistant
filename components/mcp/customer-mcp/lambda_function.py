"""Customer MCP — get_customer_profile, register_customer, update_profile, get_order_history.

Production-ready. Full update_profile ported from v1.
"""
import json
import os
import uuid
from datetime import datetime
from decimal import Decimal

import boto3

dynamodb = boto3.resource("dynamodb")
customer_table = dynamodb.Table(os.environ.get("CUSTOMER_TABLE", "Customers"))
order_table = dynamodb.Table(os.environ.get("ORDER_TABLE", "Orders"))


def respond(code, body):
    return {"statusCode": code, "body": json.dumps(body, default=str)}


def get_customer_profile(params):
    phone = params.get("phone")
    cid = params.get("customer_id")
    email = params.get("email", "").strip().lower() if params.get("email") else None

    if cid:
        item = customer_table.get_item(Key={"customer_id": cid}).get("Item")
        return item or {"error": "not found"}
    if email:
        resp = customer_table.query(
            IndexName="email-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("email").eq(email),
        )
        items = resp.get("Items", [])
        return items[0] if items else {"error": "not found"}
    if phone:
        digits = "".join(c for c in phone if c.isdigit())
        for try_phone in [phone, digits]:
            if not try_phone:
                continue
            resp = customer_table.query(
                IndexName="phone-index",
                KeyConditionExpression=boto3.dynamodb.conditions.Key("phone").eq(try_phone),
            )
            items = resp.get("Items", [])
            if items:
                return items[0]
        return {"error": "not found"}
    return {"error": "phone, email, or customer_id required"}


def register_customer(params):
    name = params.get("name", "").strip()
    if not name:
        fn = params.get("first_name", "").strip()
        ln = params.get("last_name", "").strip()
        name = f"{fn} {ln}".strip()
    phone = params.get("phone", "").strip()
    email = params.get("email", "").strip().lower() if params.get("email") else None

    if not name:
        return {"error": "name is required"}
    if not phone:
        return {"error": "phone is required"}

    # Duplicate check
    if phone:
        resp = customer_table.query(
            IndexName="phone-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("phone").eq(phone),
        )
        if resp.get("Items"):
            return {"error": "phone already registered", "customer_id": resp["Items"][0]["customer_id"]}
    if email:
        resp = customer_table.query(
            IndexName="email-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("email").eq(email),
        )
        if resp.get("Items"):
            return {"error": "email already registered", "customer_id": resp["Items"][0]["customer_id"]}

    cid = f"CUST-{uuid.uuid4().hex[:6].upper()}"
    parts = name.split(None, 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else ""

    item = {
        "customer_id": cid,
        "first_name": first_name,
        "last_name": last_name,
        "phone": phone,
        "tier": "Standard",
        "default_address": {},
        "payment_methods": [],
        "preferences": {},
        "created_at": datetime.utcnow().isoformat(),
    }
    if email:
        item["email"] = email
    customer_table.put_item(Item=item)
    return {"customer_id": cid, "name": name}


def update_profile(params):
    """Update customer profile: name, phone, email, shipping_address, payment_methods, preferences."""
    cid = params.get("customer_id")
    if not cid:
        return {"error": "customer_id required"}

    resp = customer_table.get_item(Key={"customer_id": cid})
    if not resp.get("Item"):
        return {"error": "customer not found"}

    update_parts = []
    expr_values = {}
    expr_names = {}

    if "shipping_address" in params:
        update_parts.append("#addr = :addr")
        expr_names["#addr"] = "default_address"
        expr_values[":addr"] = params["shipping_address"]
    if "payment_methods" in params:
        update_parts.append("payment_methods = :pm")
        expr_values[":pm"] = params["payment_methods"]
    if "preferences" in params:
        update_parts.append("preferences = :pref")
        expr_values[":pref"] = params["preferences"]
    if "selection_cost" in params:
        # Per-station cost carried across the booth handoff (Selection → Try-On).
        # Floats must be Decimal for DynamoDB.
        sc = params["selection_cost"] or {}
        update_parts.append("selection_cost = :sc")
        expr_values[":sc"] = {k: Decimal(str(v)) for k, v in sc.items()}
    if "phone" in params:
        update_parts.append("phone = :phone")
        expr_values[":phone"] = params["phone"]
    if "email" in params:
        update_parts.append("email = :email")
        expr_values[":email"] = params["email"].lower()
    if "name" in params:
        name = params["name"].strip()
        if name:
            parts = name.split(None, 1)
            update_parts.append("first_name = :fn")
            expr_values[":fn"] = parts[0]
            update_parts.append("last_name = :ln")
            expr_values[":ln"] = parts[1] if len(parts) > 1 else ""

    if not update_parts:
        return {"error": "no fields to update"}

    kwargs = {
        "Key": {"customer_id": cid},
        "UpdateExpression": "SET " + ", ".join(update_parts),
        "ExpressionAttributeValues": expr_values,
        "ReturnValues": "ALL_NEW",
    }
    if expr_names:
        kwargs["ExpressionAttributeNames"] = expr_names

    result = customer_table.update_item(**kwargs)
    return {"message": "updated", "customer": result.get("Attributes", {})}


def get_order_history(params):
    cid = params.get("customer_id")
    if not cid:
        return {"error": "customer_id required"}
    start_date = params.get("start_date")
    end_date = params.get("end_date")

    if start_date or end_date:
        key_expr = boto3.dynamodb.conditions.Key("customer_id").eq(cid)
        if start_date and end_date:
            key_expr = key_expr & boto3.dynamodb.conditions.Key("created_at").between(start_date, end_date)
        elif start_date:
            key_expr = key_expr & boto3.dynamodb.conditions.Key("created_at").gte(start_date)
        elif end_date:
            key_expr = key_expr & boto3.dynamodb.conditions.Key("created_at").lte(end_date)
        resp = order_table.query(
            IndexName="customer-order-date-index",
            KeyConditionExpression=key_expr,
            ScanIndexForward=False,
        )
    else:
        resp = order_table.query(
            IndexName="customer-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid),
        )

    orders = resp.get("Items", [])
    product_filter = params.get("product", "").lower()
    brand_filter = params.get("brand", "").lower()
    if product_filter or brand_filter:
        filtered = []
        for order in orders:
            for item in order.get("items", []):
                if product_filter and product_filter in item.get("product_name", "").lower():
                    filtered.append(order)
                    break
                if brand_filter and brand_filter in item.get("brand", "").lower():
                    filtered.append(order)
                    break
        orders = filtered

    return {"orders": orders, "count": len(orders)}


TOOLS = {
    "get_customer_profile": get_customer_profile,
    "register_customer": register_customer,
    "update_profile": update_profile,
    "get_order_history": get_order_history,
}


def lambda_handler(event, context):
    body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event
    tool = body.get("tool") or body.get("params", {}).get("name", "")
    args = body.get("arguments") or body.get("params", {}).get("arguments", {})
    fn = TOOLS.get(tool)
    if not fn:
        return respond(400, {"error": f"unknown tool: {tool}"})
    return respond(200, fn(args))
