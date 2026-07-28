"""Modular, extensible VTON prompt-engineering registry.

Every VTON model has its own self-contained config module (prompt templates, negatives,
cfg, category mappings) exposing a common `build_request(category, ...)` contract. The
orchestrator calls `vton_engines.build_request(engine, category, ...)` and stays engine-
agnostic. Adding a new image-edit model = drop in a new module + register it here.

    from . import vton_engines
    req = vton_engines.build_request("qwen_image_edit", category="mens_polo",
                                     garment_type="polo shirt", steps=50)
    # -> {prompt, negative_prompt, true_cfg_scale, num_inference_steps, seed, body_region, ...}
"""
from __future__ import annotations

from . import base, qwen_image_edit, fashn

# engine id -> config module
ENGINES = {
    qwen_image_edit.ENGINE_ID: qwen_image_edit,
    fashn.ENGINE_ID: fashn,
}


def get(engine: str):
    return ENGINES.get(engine)


def is_registered(engine: str) -> bool:
    return engine in ENGINES


def build_request(engine: str, category: str, **kwargs) -> dict:
    """Build the per-model VTON request for a product category.

    Raises KeyError for an unknown engine so callers can fall back explicitly.
    Extra kwargs (garment_type, product_body_region, steps, cfg_override, seed) are
    passed through to the engine module (each ignores what it doesn't use).
    """
    mod = ENGINES.get(engine)
    if mod is None:
        raise KeyError(f"unknown VTON engine: {engine!r} (registered: {list(ENGINES)})")
    return mod.build_request(category, **kwargs)


__all__ = ["ENGINES", "get", "is_registered", "build_request", "base"]
