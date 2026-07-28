"""Size Recommendation MCP — photo_size_recommendation, recommend_size,
save_measurements.

Production-ready. Full size chart scoring algorithm ported from v1.
"""
import json
import os
from datetime import datetime
from decimal import Decimal

import boto3

dynamodb = boto3.resource("dynamodb")
customer_table = dynamodb.Table(os.environ.get("CUSTOMER_TABLE", "Customers"))
product_table = dynamodb.Table(os.environ.get("PRODUCT_TABLE", "Products"))
size_chart_table = dynamodb.Table(os.environ.get("SIZE_CHART_TABLE", "SizeCharts"))

TRYON_BUCKET = os.environ.get("TRYON_BUCKET", "")

SIZE_CHART_CATEGORY_MAP = {
    "mens_tshirt": "tops", "mens_polo": "tops", "mens_shirt": "tops",
    "mens_hoodie": "tops", "mens_jacket": "outerwear", "mens_sweater": "tops",
    "womens_tshirt": "tops", "womens_blouse": "tops", "womens_croptop": "tops",
    "womens_hoodie": "tops", "womens_cardigan": "tops",
    "mens_jeans": "bottoms", "mens_chinos": "bottoms", "mens_shorts": "bottoms",
    "mens_joggers": "bottoms", "womens_jeans": "bottoms", "womens_skirt": "bottoms",
    "womens_shorts": "bottoms", "womens_leggings": "bottoms",
    "womens_dress": "dresses",
}

HEIGHT_RATIOS = {
    "men": {
        "chest": 0.57, "waist": 0.48, "hip": 0.56, "shoulder_width": 0.27,
        "arm_length": 0.36, "shirt_length": 0.42, "thigh_circumference": 0.34,
        "trouser_length": 0.59, "neck": 0.23,
    },
    "women": {
        "chest": 0.54, "waist": 0.44, "hip": 0.58, "shoulder_width": 0.24,
        "arm_length": 0.34, "shirt_length": 0.39, "thigh_circumference": 0.35,
        "trouser_length": 0.56, "neck": 0.21,
    },
}


def respond(code, body):
    return {"statusCode": code, "body": json.dumps(body, default=str)}


def _to_decimal(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(i) for i in obj]
    return obj


def photo_size_recommendation(p):
    """Invoke the existing size-rec Lambda (v1) via direct invocation."""
    func = os.environ.get("SIZE_RECOMMENDATION_FUNCTION")
    if not func:
        return {"error": "SIZE_RECOMMENDATION_FUNCTION not configured"}
    cid = p.get("customer_id")
    pid = p.get("product_id")
    if not cid or not pid:
        return {"error": "customer_id and product_id required"}
    payload = {
        "photo_s3_key": f"photos/{cid}/photo.png",
        "photo_bucket": TRYON_BUCKET,
        "product_id": pid,
        "customer_id": cid,
        "marker_color": p.get("marker_color", "red"),
        "marker_height_cm": float(p.get("marker_height_cm", 150)),
    }
    try:
        lam = boto3.client("lambda")
        r = lam.invoke(FunctionName=func, Payload=json.dumps(payload))
        result = json.loads(r["Payload"].read())
        if result.get("statusCode") == 200:
            return json.loads(result["body"])
        return json.loads(result.get("body", "{}"))
    except Exception as e:
        return {"error": f"Size recommendation failed: {e}"}


def save_measurements(p):
    """Save body measurements to customer profile."""
    cid = p.get("customer_id")
    measurements = p.get("measurements")
    source = p.get("source", "manual")
    if not cid or not measurements:
        return {"error": "customer_id and measurements required"}

    item = _to_decimal(measurements)
    item["source"] = source
    item["measured_at"] = datetime.utcnow().isoformat()

    customer_table.update_item(
        Key={"customer_id": cid},
        UpdateExpression="SET body_measurements = :m",
        ExpressionAttributeValues={":m": item},
    )
    return {"message": "Measurements saved", "customer_id": cid}


def recommend_size(p):
    """Recommend size based on measurements or height estimate.

    If height is provided (photo measurement failed), estimate body
    measurements from height ratios, save them, then score against
    the size chart.
    """
    cid = p.get("customer_id")
    pid = p.get("product_id")
    if not cid or not pid:
        return {"error": "customer_id and product_id required"}

    # If height provided, estimate measurements first
    height = p.get("height")
    gender = p.get("gender", "women")
    if height:
        h = float(height)
        ratios = HEIGHT_RATIOS.get(gender, HEIGHT_RATIOS["women"])
        est = {k: round(h * v, 1) for k, v in ratios.items()}
        save_measurements({
            "customer_id": cid,
            "measurements": est,
            "source": "height_estimate",
        })

    # Load customer measurements
    cust = customer_table.get_item(Key={"customer_id": cid}).get("Item")
    if not cust or "body_measurements" not in cust:
        return {"error": "No body measurements found. Please measure first."}

    body_m = cust["body_measurements"]
    body_floats = {k: float(v) for k, v in body_m.items() if isinstance(v, (int, float, Decimal))}

    # Load product
    prod = product_table.get_item(Key={"product_id": pid}).get("Item")
    if not prod:
        return {"error": "Product not found"}

    category = prod.get("category", "")
    prod_gender = prod.get("gender", "unisex").lower()
    chart_category = SIZE_CHART_CATEGORY_MAP.get(category, category)

    if category in ("accessories", "footwear"):
        return {"recommendation": "Size recommendation is not available for this product category."}

    g = prod_gender if prod_gender != "unisex" else "men"

    # Load size charts (optional — degrade to height-based sizing if the table
    # is absent/inaccessible or empty).
    try:
        sc_resp = size_chart_table.scan(
            FilterExpression=(
                boto3.dynamodb.conditions.Attr("category").eq(chart_category)
                & boto3.dynamodb.conditions.Attr("gender").eq(g)
                & boto3.dynamodb.conditions.Attr("vendor").eq("default")
            )
        )
        charts = sc_resp.get("Items", [])
    except Exception:  # noqa: BLE001 — no size-chart table configured -> height fallback
        charts = []
    if not charts:
        # Fallback: height-based simple sizing
        chest = body_floats.get("chest", 90)
        if chest < 88:
            size = "S"
        elif chest < 96:
            size = "M"
        elif chest < 104:
            size = "L"
        else:
            size = "XL"
        return {
            "recommended_size": size,
            "confidence": 0.5,
            "recommendation": f"Based on your measurements, size {size} should work.",
            "source": "fallback_chest",
        }

    # Parse measurement ranges
    for c in charts:
        for k, v in c.get("measurements_cm", {}).items():
            c["measurements_cm"][k] = [float(x) for x in v]

    # Score each size
    def score_size(body_m_f, entry):
        total, matched, breakdown = 0.0, 0, {}
        for key, (lo, hi) in entry["measurements_cm"].items():
            val = body_m_f.get(key)
            if val is None:
                continue
            matched += 1
            mid = (lo + hi) / 2
            rng = (hi - lo) / 2
            if rng == 0:
                rng = 1
            if val < lo:
                total += ((lo - val) / rng) ** 2 * 2
                breakdown[key] = {"delta_cm": round(val - lo, 1), "position": "below_min"}
            elif val > hi:
                total += ((val - hi) / rng) ** 2
                breakdown[key] = {"delta_cm": round(val - hi, 1), "position": "above_max"}
            else:
                total += ((val - mid) / rng) ** 2 * 0.1
                breakdown[key] = {"delta_cm": round(val - mid, 1), "position": "within_range"}
        return (total / matched if matched else float("inf")), breakdown

    scores = []
    for entry in charts:
        pen, bd = score_size(body_floats, entry)
        scores.append((entry["size"], pen, bd))
    scores.sort(key=lambda x: x[1])

    best_size, best_score, best_bd = scores[0]
    confidence = round(max(0.0, 1.0 - best_score / 5.0), 2)
    rec = f"Based on your body measurements, size {best_size} will fit you the best."
    alt = None
    if len(scores) > 1:
        a_sz, a_sc, _ = scores[1]
        if a_sc - best_score < 0.5:
            rec += f" Size {a_sz} would also work well for your build."
        alt = {"size": a_sz, "note": f"If you prefer a different fit, size {a_sz} could also work."}

    return {
        "recommended_size": best_size,
        "confidence": confidence,
        "recommendation": rec,
        "alternative": alt,
    }


TOOLS = {
    "photo_size_recommendation": photo_size_recommendation,
    "recommend_size": recommend_size,
    "save_measurements": save_measurements,
}


def lambda_handler(event, context):
    body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event
    tool = body.get("tool") or body.get("params", {}).get("name", "")
    args = body.get("arguments") or body.get("params", {}).get("arguments", {})
    fn = TOOLS.get(tool)
    if not fn:
        return respond(400, {"error": f"unknown tool: {tool}"})
    return respond(200, fn(args))
