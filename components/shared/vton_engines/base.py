"""Shared product taxonomy for VTON engines.

Maps a product category to (garment_descriptor, body_region, cfg_scale). This is the
single source of truth every VTON engine's prompt-engineering module builds on. Ported
verbatim from v1's tested `qwen3_image_edit_vton_prompts.CATEGORY_CONFIG` so behavior
matches the v1 reference. `body_region` is the "which part of the outfit changes" signal
that every engine consumes (Qwen selects a prompt template by it; FASHN maps it to its
`category` param). Adding a new product category = one line here.
"""
from __future__ import annotations

# category -> (garment_descriptor, body_region, cfg_scale)
CATEGORY_CONFIG: dict[str, tuple[str, str, float]] = {
    # Upper body — tops
    "mens_tshirt":     ("t-shirt",            "upper_body", 3.0),
    "mens_polo":       ("polo shirt",         "upper_body", 3.0),
    "mens_shirt":      ("full sleeves shirt", "upper_body", 3.0),
    "mens_hoodie":     ("hoodie",             "upper_body", 3.0),
    "mens_jacket":     ("jacket",             "upper_body", 3.0),
    "mens_sweater":    ("sweater",            "upper_body", 3.0),
    "womens_tshirt":   ("t-shirt",            "upper_body", 3.0),
    "womens_blouse":   ("blouse",             "upper_body", 3.0),
    "womens_croptop":  ("crop top",           "upper_body", 3.0),
    "womens_hoodie":   ("hoodie",             "upper_body", 3.0),
    "womens_cardigan": ("cardigan",           "upper_body", 3.0),
    # Lower body — bottoms
    "mens_jeans":      ("jeans",              "lower_body", 4.0),
    "mens_chinos":     ("chinos",             "lower_body", 4.0),
    "mens_shorts":     ("shorts",             "lower_body", 3.5),
    "mens_joggers":    ("joggers",            "lower_body", 4.0),
    "womens_jeans":    ("jeans",              "lower_body", 4.0),
    "womens_skirt":    ("skirt",              "lower_body", 3.0),
    "womens_shorts":   ("shorts",             "lower_body", 3.5),
    "womens_leggings": ("leggings",           "lower_body", 4.0),
    # Full body — dresses
    "womens_dress":    ("dress",              "full_body",  3.5),
    # Footwear
    "sneakers":        ("sneakers",           "feet", 4.0),
    "running_shoes":   ("running shoes",      "feet", 4.0),
    "loafers":         ("loafers",            "feet", 4.0),
    "boots":           ("boots",              "feet", 4.0),
    "sandals":         ("sandals",            "feet", 4.0),
    "slippers":        ("slippers",           "feet", 4.0),
}

DEFAULT = ("clothing", "upper_body", 3.0)


def resolve(category: str, product_body_region: str | None = None) -> tuple[str, str, float]:
    """Return (garment_descriptor, body_region, cfg_scale) for a category.

    A product may override the derived body_region via its `body_region` metadata
    (v1 parity: `prod.get("body_region", ...)`).
    """
    garment, region, cfg = CATEGORY_CONFIG.get(category, DEFAULT)
    if product_body_region:
        region = product_body_region
    return garment, region, cfg
