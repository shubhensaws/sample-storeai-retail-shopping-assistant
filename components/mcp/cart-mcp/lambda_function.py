"""Cart MCP — get_cart, add_to_cart, remove_from_cart, get_tryon_room,
add_to_tryon_room, remove_from_tryon_room, checkout."""
import json, os, uuid, boto3
from datetime import datetime
from decimal import Decimal

dynamodb = boto3.resource("dynamodb")
cart_table = dynamodb.Table(os.environ.get("CART_TABLE", "Carts"))
tryon_room_table = dynamodb.Table(os.environ.get("TRYON_ROOM_TABLE", "TryOnRoom"))
order_table = dynamodb.Table(os.environ.get("ORDER_TABLE", "Orders"))
product_table = dynamodb.Table(os.environ.get("PRODUCT_TABLE", "Products"))


def respond(code, body):
    return {"statusCode": code, "body": json.dumps(body, default=str)}


def get_cart(p):
    cid = p.get("customer_id")
    if not cid: return {"error": "customer_id required"}
    items = cart_table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid)).get("Items", [])
    return {"items": items, "count": len(items)}


def add_to_cart(p):
    cid, pid, size = p.get("customer_id"), p.get("product_id"), p.get("size", "").upper()
    if not all([cid, pid, size]): return {"error": "customer_id, product_id, size required"}
    prod = product_table.get_item(Key={"product_id": pid}).get("Item", {})
    cart_item_id = f"CI-{uuid.uuid4().hex[:8].upper()}"
    cart_table.put_item(Item={
        "customer_id": cid, "cart_item_id": cart_item_id, "product_id": pid,
        "product_name": prod.get("name", ""), "brand": prod.get("brand", ""),
        "size": size, "quantity": 1, "price": prod.get("price", 0),
        "added_at": datetime.utcnow().isoformat(),
    })
    return {"cart_item_id": cart_item_id, "message": f"Added {prod.get('name', pid)}"}


def remove_from_cart(p):
    cid, ciid = p.get("customer_id"), p.get("cart_item_id")
    if not all([cid, ciid]): return {"error": "customer_id, cart_item_id required"}
    cart_table.delete_item(Key={"customer_id": cid, "cart_item_id": ciid})
    return {"message": "removed"}


def get_tryon_room(p):
    cid = p.get("customer_id")
    if not cid: return {"error": "customer_id required"}
    items = tryon_room_table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid)).get("Items", [])
    return {"items": items, "count": len(items)}


def add_to_tryon_room(p):
    cid, pid = p.get("customer_id"), p.get("product_id")
    if not all([cid, pid]): return {"error": "customer_id, product_id required"}
    prod = product_table.get_item(Key={"product_id": pid}).get("Item", {})
    tryon_room_table.put_item(Item={
        "customer_id": cid, "product_id": pid,
        "product_name": prod.get("name", ""), "added_at": datetime.utcnow().isoformat(),
    })
    return {"message": f"Added {prod.get('name', pid)} to try-on room"}


def remove_from_tryon_room(p):
    cid, pid = p.get("customer_id"), p.get("product_id")
    if not all([cid, pid]): return {"error": "customer_id, product_id required"}
    tryon_room_table.delete_item(Key={"customer_id": cid, "product_id": pid})
    return {"message": "removed"}


def checkout(p):
    cid = p.get("customer_id")
    if not cid: return {"error": "customer_id required"}
    items = cart_table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid)).get("Items", [])
    if not items:
        # Check if try-on room has items that need to be moved
        tryon_items = tryon_room_table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("customer_id").eq(cid)).get("Items", [])
        if tryon_items:
            return {"error": "cart_empty_tryon_has_items", "tryon_count": len(tryon_items),
                    "message": f"Cart is empty but you have {len(tryon_items)} item(s) in your try-on room. To checkout, add them to your cart with a size first."}
        return {"error": "cart_empty", "message": "Your cart is empty. Browse some products first!"}
    subtotal = sum(float(i.get("price", 0)) * int(i.get("quantity", 1)) for i in items)
    tax = round(subtotal * 0.08, 2)
    oid = f"ORD-{uuid.uuid4().hex[:10].upper()}"
    order_table.put_item(Item={
        "order_id": oid, "customer_id": cid,
        "items": [{"product_name": i.get("product_name"), "size": i.get("size"), "price": i.get("price")} for i in items],
        "subtotal": Decimal(str(subtotal)), "tax": Decimal(str(tax)),
        "total": Decimal(str(round(subtotal + tax, 2))),
        "status": "confirmed", "created_at": datetime.utcnow().isoformat(),
    })
    with cart_table.batch_writer() as batch:
        for i in items:
            batch.delete_item(Key={"customer_id": cid, "cart_item_id": i["cart_item_id"]})
    return {"order_id": oid, "status": "confirmed", "total": round(subtotal + tax, 2)}


TOOLS = {
    "get_cart": get_cart, "add_to_cart": add_to_cart, "remove_from_cart": remove_from_cart,
    "get_tryon_room": get_tryon_room, "add_to_tryon_room": add_to_tryon_room,
    "remove_from_tryon_room": remove_from_tryon_room, "checkout": checkout,
}


def lambda_handler(event, context):
    body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event
    tool = body.get("tool") or body.get("params", {}).get("name", "")
    args = body.get("arguments") or body.get("params", {}).get("arguments", {})
    fn = TOOLS.get(tool)
    if not fn: return respond(400, {"error": f"unknown tool: {tool}"})
    return respond(200, fn(args))
