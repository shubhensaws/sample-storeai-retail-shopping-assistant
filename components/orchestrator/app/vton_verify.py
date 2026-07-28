"""VTON output verification + FASHN fallback (modular).

Verifies a generated try-on image and, if needed, falls back to a second engine.
Flow (for the Qwen engine):
  Qwen image -> Nova Lite safety check -> if flagged, FASHN -> re-check -> if still
  flagged or FASHN errors, signal content review.

Toggle with VTON_SAFETY_ENABLED (default ON). When off, images pass through unverified.
Model + region are overridable (VTON_SAFETY_MODEL_ID / VTON_SAFETY_REGION) so the
verifier can be swapped (e.g. to Nova 2 Lite) without touching call sites.
"""
from __future__ import annotations

import json
import os

# On by default. Set VTON_SAFETY_ENABLED to false/0/no/off to disable verification + fallback.
SAFETY_ENABLED = os.environ.get("VTON_SAFETY_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")
SAFETY_MODEL_ID = os.environ.get("VTON_SAFETY_MODEL_ID", "us.amazon.nova-lite-v1:0")
SAFETY_REGION = os.environ.get("VTON_SAFETY_REGION", os.environ.get("AWS_REGION", "us-east-1"))

# body_region (from vton_engines) -> garment class used to tailor the safety prompt.
GARMENT_CLASS = {"upper_body": "UPPER_BODY", "lower_body": "LOWER_BODY", "full_body": "FULL_BODY", "feet": "FOOTWEAR"}

# Generic-but-distinguishable marker. Does NOT reveal the safety reason to the shopper,
# but is identifiable by operators as an image-content issue (not a generation/inference failure).
CONTENT_REVIEW_ERROR = "content_review"
CONTENT_REVIEW_MESSAGE = (
    "This virtual try-on couldn't be completed for the selected item. "
    "Please try a different product or photo."
)

_GARMENT_CONTEXT = {
    "UPPER_BODY": "The person should be wearing a top/shirt/jacket that covers the torso. Arms may be bare. The chest should be covered with no cleavage or exposed stomach.",
    "LOWER_BODY": "The person should be wearing pants/shorts/skirt. For shorts: thighs may be partially visible but no underwear or excessive exposure. For skirts: knee-length or longer.",
    "FULL_BODY": "The person should be wearing a dress or full outfit that properly covers the body — no exposed chest, stomach, or private areas.",
    "FOOTWEAR": "Focus is on shoes. The rest of the body should remain properly clothed as in the original photo.",
}


def check_image_safety(image_bytes: bytes, garment_class: str) -> dict:
    """Nova Lite vision check → {"safe": bool, ...}. Fails OPEN (defaults to safe) so a
    verifier outage never blocks a legitimate try-on."""
    import boto3
    try:
        ctx = _GARMENT_CONTEXT.get(garment_class, "The person should be appropriately dressed in clothing.")
        prompt = (
            "Analyze this virtual try-on image for a retail clothing store demo.\n\n"
            f"Context: {ctx}\n\n"
            "Flag (safe:false) if ANY are present: exposed chest/breasts/significant cleavage; exposed stomach/midriff "
            "(unless a crop top); visible underwear/private areas; see-through garment revealing skin; wardrobe malfunction.\n"
            "ACCEPTABLE (do NOT flag): bare arms/forearms, lower legs below the knee, neck/collarbone/normal neckline, ankles/feet.\n\n"
            'Respond with ONLY JSON: {"safe": true} if appropriate, or {"safe": false, "reason": "..."} if not.'
        )
        rt = boto3.client("bedrock-runtime", region_name=SAFETY_REGION)
        resp = rt.converse(
            modelId=SAFETY_MODEL_ID,
            messages=[{"role": "user", "content": [
                {"image": {"format": "png", "source": {"bytes": image_bytes}}},
                {"text": prompt},
            ]}],
            inferenceConfig={"maxTokens": 150, "temperature": 0.0},
        )
        text = resp["output"]["message"]["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(text)
    except Exception as e:  # noqa: BLE001
        print(f"[VTON-SAFETY] check skipped: {e}", flush=True)
        return {"safe": True, "note": f"skipped: {e}"}


def fashn_infer(garment_bytes: bytes, photo_bytes: bytes, category: str) -> bytes:
    """Generate a FASHN try-on and return PNG bytes (raises on failure)."""
    import urllib.request as _ur
    import uuid as _uuid
    from . import vton_engines
    fashn_url = os.environ.get("FASHN_VTON_URL", "http://storeai-fashn-vton:8081")
    fashn_cat = vton_engines.build_request("fashn_vton", category)["category"]
    boundary = _uuid.uuid4().hex
    parts = []
    for name, fname, data in [("image1", "garment.png", garment_bytes), ("image2", "person.png", photo_bytes)]:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{fname}\"\r\nContent-Type: image/png\r\n\r\n".encode()
            + data + b"\r\n"
        )
    for name, val in [("category", fashn_cat), ("num_inference_steps", "30"), ("seed", "42")]:
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{val}\r\n".encode())
    parts.append(f"--{boundary}--\r\n".encode())
    req = _ur.Request(f"{fashn_url}/infer", data=b"".join(parts), method="POST",
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return _ur.urlopen(req, timeout=120).read()


def verify_or_fallback(result_bytes: bytes, garment_bytes: bytes, photo_bytes: bytes, category: str, region: str):
    """Verify a Qwen result; if flagged, retry with FASHN and re-verify.

    Returns (final_bytes | None, engine_used). None => content review (no safe image).
    When SAFETY_ENABLED is False, returns the Qwen image unchecked.
    """
    if not SAFETY_ENABLED:
        return result_bytes, "qwen_image_edit"
    gclass = GARMENT_CLASS.get(region, "UPPER_BODY")
    if check_image_safety(result_bytes, gclass).get("safe", True):
        return result_bytes, "qwen_image_edit"
    print("[VTON-SAFETY] qwen output flagged — falling back to FASHN", flush=True)
    try:
        fb = fashn_infer(garment_bytes, photo_bytes, category)
        if check_image_safety(fb, gclass).get("safe", True):
            return fb, "fashn_vton"
        print("[VTON-SAFETY] FASHN fallback also flagged", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[VTON-SAFETY] FASHN fallback failed: {e}", flush=True)
    return None, "qwen_image_edit"
