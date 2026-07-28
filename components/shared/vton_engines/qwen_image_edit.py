"""Prompt-engineering module for the Qwen-Image-Edit VTON engine.

Ported verbatim from v1's `qwen3_image_edit_vton_prompts.py` (tested, produces
acceptable try-ons). Qwen is highly prompt-sensitive, so this is intentionally a
dedicated, self-contained module: short directive prompts per body region, with
preservation instructions concentrated in the negative prompt.

To tune Qwen behavior, edit ONLY this file. To add another image-edit model, add a
sibling module with the same `build_request(...)` signature and register it in
`__init__.py`.
"""
from __future__ import annotations

from . import base

ENGINE_ID = "qwen_image_edit"

# Prompt templates per body region — v1's ACTUAL tested set from
# lambda/vton-api/qwen3_image_edit_vton_prompts.py (get_vton_prompt), which the v1
# vton-api Lambda used at inference (lambda_function.py:140). Descriptive phrasing
# ("The person ... wearing ...") + "Do not add any accessories or items not in the
# original images"; preservation reinforced by the accessory-blocking negative below.
PROMPT_TEMPLATES = {
    "upper_body": "The person in image 2 wearing the {garment} from image 1. Only change the upper body clothing. Keep the face, hair, pose, lower body, and background exactly the same. Do not add any accessories or items not in the original images.",
    "lower_body": "The person in image 2 wearing the {garment} from image 1. Only change the lower body clothing. Keep the face, hair, pose, upper body, and background exactly the same. Do not add any accessories or items not in the original images.",
    "full_body":  "The person in image 2 wearing the {garment} from image 1. Replace the entire outfit. Keep the face, hair, pose, and background exactly the same. Do not add any accessories or items not in the original images.",
    "feet":       "Replace the footwear on both feet of the person in image 2 with the {garment} from image 1. The person must wear the exact {garment} shown in image 1.",
}

# Negative prompt — v1's ACTUAL set (qwen3_image_edit_vton_prompts.NEGATIVE_PROMPT):
# blocks deformity AND added accessories/items (watch, jewelry, sunglasses, hat, bag, etc.).
NEGATIVE_PROMPT = "deformed face, blurry, distorted body, extra limbs, low quality, nude, nudity, extra fingers, missing limbs, watermark, text overlay, extra accessories, watch, jewelry, added items, new objects, sunglasses, hat, bag"


def build_request(category: str, garment_type: str | None = None,
                  product_body_region: str | None = None,
                  steps: int = 50, cfg_override: float | None = None,
                  seed: int = 42) -> dict:
    """Build the Qwen /infer parameters for a product category.

    Returns a dict with the prompt, negative_prompt, true_cfg_scale, num_inference_steps,
    seed, and the resolved body_region + garment descriptor (for logging/telemetry).
    """
    garment, region, cfg = base.resolve(category, product_body_region)
    if garment_type:
        garment = garment_type
    template = PROMPT_TEMPLATES.get(region, PROMPT_TEMPLATES["upper_body"])
    prompt = template.replace("{garment}", garment)
    return {
        "engine": ENGINE_ID,
        "body_region": region,
        "garment_type": garment,
        "prompt": prompt,
        "negative_prompt": NEGATIVE_PROMPT,
        "true_cfg_scale": float(cfg_override) if cfg_override else cfg,
        "num_inference_steps": int(steps),
        "seed": int(seed),
    }
