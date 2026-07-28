"""Config module for the FASHN VTON engine.

FASHN is image-conditioned (no text prompt): it takes a person image, a garment image,
and a `category` (the FASHN API's `tops | bottoms | one-pieces | auto`). So its
"prompt engineering" is intentionally minimal — the body-region -> FASHN-category
mapping plus inference defaults — but it's extracted here so every engine has a
consistent, self-contained config module (same `build_request` contract as Qwen).

Ref: FASHN v1.6 VTON expects `category` in {auto, tops, bottoms, one-pieces}.
"""
from __future__ import annotations

from . import base

ENGINE_ID = "fashn_vton"

# body_region -> FASHN `category` param.
REGION_TO_FASHN_CATEGORY = {
    "upper_body": "tops",
    "lower_body": "bottoms",
    "full_body":  "one-pieces",
    "feet":       "auto",   # FASHN has no footwear category; let it auto-detect
}

DEFAULT_STEPS = 30  # FASHN default (v1/v2 parity)


def build_request(category: str, garment_type: str | None = None,
                  product_body_region: str | None = None,
                  steps: int = DEFAULT_STEPS, seed: int = 42, **_ignored) -> dict:
    """Build FASHN /infer parameters for a product category.

    Returns the FASHN `category`, resolved body_region + garment descriptor, and
    inference defaults. No prompt/negative/cfg (FASHN is image-conditioned).
    """
    garment, region, _cfg = base.resolve(category, product_body_region)
    if garment_type:
        garment = garment_type
    return {
        "engine": ENGINE_ID,
        "body_region": region,
        "garment_type": garment,
        "category": REGION_TO_FASHN_CATEGORY.get(region, "auto"),
        "num_inference_steps": int(steps),
        "seed": int(seed),
    }
