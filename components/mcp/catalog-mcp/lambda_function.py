"""Catalog MCP — search_products, get_product_details, get_recommendations.

Production-ready. Full search logic ported from v1 with GSI queries,
synonym expansion, fuzzy brand matching, and all filters.
"""
import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")
product_table = dynamodb.Table(os.environ.get("PRODUCT_TABLE", "Products"))

SYNONYMS = {
    "pants": "jeans chinos joggers trousers",
    "trousers": "jeans chinos pants",
    "top": "tshirt t-shirt blouse croptop hoodie",
    "tops": "tshirt t-shirt blouse croptop hoodie",
    "jacket": "jacket blazer cardigan hoodie",
    "coat": "jacket blazer puffer",
    "sweater": "sweater cardigan hoodie",
    "pullover": "sweater hoodie",
    "formal": "blazer shirt chinos",
    "business": "blazer shirt chinos",
    "office": "blazer shirt chinos skirt",
    "casual": "tshirt hoodie joggers shorts",
    "bottom": "jeans chinos joggers shorts skirt leggings",
    "bottoms": "jeans chinos joggers shorts skirt leggings",
    "footwear": "sneakers shoes loafers boots sandals slippers",
    "shoes": "sneakers running_shoes loafers boots",
    "dress": "dress skirt",
    "winter": "jacket hoodie sweater cardigan puffer",
    "summer": "tshirt shorts sandals croptop dress skirt",
    "ethnic": "dress skirt",
    "sportswear": "joggers sneakers hoodie shorts",
    "party": "blazer dress skirt",
    "workout": "joggers shorts sneakers hoodie",
    "warm": "hoodie sweater jacket puffer cardigan",
}


def respond(code, body):
    return {
        "statusCode": code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=_decimal_default),
    }


def _decimal_default(obj):
    """Convert Decimal to float for JSON serialization."""
    from decimal import Decimal
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def search_products(params: dict) -> dict:
    """Search products — mirrors V1 logic: scan + text match + synonym expansion.

    Strategy: If gender is provided as a separate param, prepend it to the query
    so text matching picks it up from category fields (e.g. "mens_tshirt" contains "mens" and "tshirt").
    This is simple, robust, and works for any combination.
    """
    category = params.get("category")
    brand = params.get("brand")
    query = params.get("query", "").lower()
    gender = params.get("gender", "").lower()
    min_price = float(params.get("min_price", 0))
    max_price = float(params.get("max_price", 99999))
    size = params.get("size", "").upper()

    # Normalize query
    query = query.replace("'s ", " ").replace("'s", "").replace("'", "").replace("`", "")
    query_singular = query.rstrip("s") if query.endswith("s") and len(query) > 3 else query

    # If gender is a separate param, merge it into the query for text matching.
    # This way "tshirt" + gender="men" becomes "mens tshirt" which matches category "mens_tshirt".
    if gender and not category:
        gender_prefix = "mens" if gender in ("men", "male") else "womens"
        if not query.startswith(gender_prefix) and not query.startswith(gender.rstrip("s")):
            query = f"{gender_prefix} {query}".strip()
            query_singular = query.rstrip("s") if query.endswith("s") and len(query) > 3 else query

    # Map combined query to exact category for GSI lookup
    QUERY_TO_CATEGORY = {
        "mens tshirt": "mens_tshirt", "men tshirt": "mens_tshirt", "men t-shirt": "mens_tshirt",
        "mens t-shirt": "mens_tshirt", "mens shirt": "mens_shirt", "men shirt": "mens_shirt",
        "mens polo": "mens_polo", "mens hoodie": "mens_hoodie", "mens jacket": "mens_jacket",
        "mens jeans": "mens_jeans", "mens shorts": "mens_shorts", "mens chinos": "mens_chinos",
        "mens joggers": "mens_joggers", "mens sweater": "mens_sweater",
        "womens tshirt": "womens_tshirt", "women tshirt": "womens_tshirt",
        "womens dress": "womens_dress", "women dress": "womens_dress",
        "womens blouse": "womens_blouse", "womens skirt": "womens_skirt",
        "womens jeans": "womens_jeans", "womens shorts": "womens_shorts",
        "womens hoodie": "womens_hoodie", "womens cardigan": "womens_cardigan",
        "womens leggings": "womens_leggings", "womens croptop": "womens_croptop",
        "women croptop": "womens_croptop", "women crop top": "womens_croptop",
    }
    if not category:
        matched_cat = QUERY_TO_CATEGORY.get(query) or QUERY_TO_CATEGORY.get(query_singular)
        if matched_cat:
            category = matched_cat
            query = ""

    # Meta-category expansion — map broad categories to actual DB categories
    CATEGORY_EXPANSION = {
        "footwear": ["sneakers", "running_shoes", "loafers", "boots", "sandals", "slippers"],
        "shoes": ["sneakers", "running_shoes", "loafers", "boots", "sandals", "slippers"],
        "tops": ["mens_tshirt", "mens_polo", "mens_shirt", "mens_hoodie", "mens_jacket", "mens_sweater",
                 "womens_tshirt", "womens_blouse", "womens_croptop", "womens_hoodie", "womens_cardigan"],
        "bottoms": ["mens_jeans", "mens_chinos", "mens_shorts", "mens_joggers",
                    "womens_jeans", "womens_skirt", "womens_shorts", "womens_leggings"],
        "dresses": ["womens_dress"],
    }

    # If category is a meta-category, expand it to a query instead
    expanded_items = None
    if category and category.lower() in CATEGORY_EXPANSION:
        expanded_cats = CATEGORY_EXPANSION[category.lower()]
        resp = product_table.scan()
        expanded_items = [i for i in resp.get("Items", []) if i.get("category") in expanded_cats]
        category = None  # Don't do GSI query below

    # Use GSI if filtering by category or brand, otherwise scan
    if category:
        resp = product_table.query(
            IndexName="category-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("category").eq(category),
        )
        if not resp.get("Items"):
            resp = product_table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr("category").contains(
                    category.lower().replace(" ", "_")
                ),
            )
    elif brand:
        resp = product_table.query(
            IndexName="brand-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("brand").eq(brand),
        )
        # Fuzzy fallback for voice transcription differences
        if not resp.get("Items"):
            resp = product_table.scan()
            brand_normalized = brand.lower().replace(" ", "")
            resp["Items"] = [
                i
                for i in resp.get("Items", [])
                if brand_normalized in i.get("brand", "").lower().replace(" ", "")
                or i.get("brand", "").lower().replace(" ", "") in brand_normalized
            ]
    else:
        resp = product_table.scan()

    items = expanded_items if expanded_items is not None else resp.get("Items", [])

    results = []
    for item in items:
        price = float(item.get("price", 0))
        if price < min_price or price > max_price:
            continue
        if size and size not in item.get("sizes", {}):
            continue
        if query:
            expanded = query
            for syn, expansion in SYNONYMS.items():
                if syn in query.split():
                    expanded += " " + expansion
            searchable = (
                f"{item.get('name', '')} {item.get('description', '')} "
                f"{item.get('brand', '')} {item.get('category', '')} "
                f"{' '.join(item.get('tags', []))}"
            ).lower()
            name_lower = item.get("name", "").lower()
            if "tee" in name_lower or "t-shirt" in name_lower:
                searchable += " tshirt t-shirt tee"
            query_clean = query.replace(" ", "").replace("-", "")
            query_clean_singular = (
                query_clean[:-1]
                if query_clean.endswith("s") and len(query_clean) > 3
                else query_clean
            )
            searchable_clean = searchable.replace(" ", "").replace("-", "")
            matched = (
                query in searchable
                or query_clean in searchable_clean
                or query_clean_singular in searchable_clean
            )
            if not matched:
                for term in expanded.split():
                    if term in searchable or term in searchable_clean:
                        matched = True
                        break
            if not matched:
                continue

        sizes_raw = item.get("sizes", [])
        available_sizes = (
            sizes_raw
            if isinstance(sizes_raw, list)
            else [s for s, qty in sizes_raw.items() if int(qty) > 0]
        )
        results.append(
            {
                "product_id": item["product_id"],
                "name": item["name"],
                "brand": item.get("brand", ""),
                "category": item.get("category", ""),
                "price": item.get("price"),
                "colors": item.get("colors", []),
                "available_sizes": available_sizes,
                "rating": item.get("rating"),
                "image_file": item.get("image_file"),
                "image_url": item.get("image_url"),
            }
        )

    return {"products": results, "count": len(results)}


def get_product_details(params: dict) -> dict:
    pid = params.get("product_id")
    if not pid:
        return {"error": "product_id required"}
    resp = product_table.get_item(Key={"product_id": pid})
    item = resp.get("Item")
    if not item:
        return {"error": "not found"}
    return dict(item)


def get_recommendations(params: dict) -> dict:
    """Recommend products in the same category, excluding the current one."""
    pid = params.get("product_id")
    if not pid:
        return {"products": [], "count": 0}
    prod = product_table.get_item(Key={"product_id": pid}).get("Item")
    if not prod:
        return {"products": [], "count": 0}
    cat = prod.get("category", "")
    if not cat:
        return {"products": [], "count": 0}
    resp = product_table.query(
        IndexName="category-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("category").eq(cat),
    )
    recs = [
        {
            "product_id": i["product_id"],
            "name": i["name"],
            "brand": i.get("brand", ""),
            "price": i.get("price"),
            "image_url": i.get("image_url"),
        }
        for i in resp.get("Items", [])
        if i["product_id"] != pid
    ][:5]
    return {"products": recs, "count": len(recs)}


TOOLS = {
    "search_products": search_products,
    "get_product_details": get_product_details,
    "get_recommendations": get_recommendations,
}


def lambda_handler(event, context):
    body = (
        json.loads(event.get("body", "{}"))
        if isinstance(event.get("body"), str)
        else event
    )
    tool = body.get("tool") or body.get("params", {}).get("name", "")
    args = body.get("arguments") or body.get("params", {}).get("arguments", {})
    fn = TOOLS.get(tool)
    if not fn:
        return respond(400, {"error": f"unknown tool: {tool}"})
    return respond(200, fn(args))
