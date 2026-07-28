#!/usr/bin/env python3
"""Generate storeai.config.json interactively (or with --defaults / non-tty).

Produces the SAME shape as deploy/ui and deploy/config/defaults.json.
Non-interactive (piped stdin or --defaults): all defaults, no prompts —
useful for unattended runs.
"""
import argparse
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(os.path.dirname(HERE), "config")
DEFAULTS = os.path.join(CONFIG_DIR, "defaults.json")

INTERACTIVE = True  # set in main


def _ask(prompt, default):
    if not INTERACTIVE:
        return default
    try:
        v = input(f"  {prompt} [{default}]: ").strip()
    except EOFError:
        return default
    return v if v else default


def _ask_bool(prompt, default):
    d = "Y/n" if default else "y/N"
    if not INTERACTIVE:
        return default
    try:
        v = input(f"  {prompt} [{d}]: ").strip().lower()
    except EOFError:
        return default
    if not v:
        return default
    return v in ("y", "yes", "true", "1")


def main():
    global INTERACTIVE
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="storeai.config.json")
    ap.add_argument("--defaults", action="store_true", help="no prompts; write defaults")
    args = ap.parse_args()
    INTERACTIVE = not args.defaults

    cfg = json.load(open(DEFAULTS))

    if INTERACTIVE:
        print("== storeai config init ==  (press Enter to accept each default)\n Global:")
    g = cfg["global"]
    g["env"] = _ask("environment (dev/prod)", g["env"])
    g["region"] = _ask("region (resources)", g["region"])
    g["stateBucketRegion"] = _ask("TF state bucket region", g["stateBucketRegion"])
    g["tfStateBucket"] = _ask("TF state bucket name", g["tfStateBucket"])
    g["stateKeyPrefix"] = _ask("TF state key prefix", g["stateKeyPrefix"])

    if INTERACTIVE:
        print(" Auth (admin sign-in user — no password is ever stored in config):")
        print("   \u2022 a real email -> Cognito emails a one-time invite; you set your own password on first sign-in")
        print("   \u2022 blank        -> creates admin@storeai.local with NO password; the deployer prints a CLI command to set one")
    cfg["prerequisites"]["auth"]["adminEmail"] = _ask("Cognito admin email (blank = admin@storeai.local)", cfg["prerequisites"]["auth"]["adminEmail"])

    if INTERACTIVE:
        print(" Optional modules:")
    m = cfg["modules"]
    # voice-nova is on by default; the rest optional
    m["whisper"]["enabled"] = _ask_bool("enable Whisper STT (GPU)", m["whisper"]["enabled"])
    m["avatar-heygen"]["enabled"] = _ask_bool("enable HeyGen avatar", m["avatar-heygen"]["enabled"])
    m["vton"]["enabled"] = _ask_bool("enable virtual try-on (VTON)", m["vton"]["enabled"])
    m["fashn-model"]["enabled"] = _ask_bool("  \u2514 FASHN VTON engine (GPU)", m["fashn-model"]["enabled"])
    m["image-edit-model"]["enabled"] = _ask_bool("  \u2514 Qwen-Image-Edit engine (Neuron)", m["image-edit-model"]["enabled"])
    m["llm"]["enabled"] = _ask_bool("enable self-hosted LLM (Qwen3, Neuron)", m["llm"]["enabled"])
    m["tts"]["enabled"] = _ask_bool("enable TTS (future)", m["tts"]["enabled"])

    # Prereqs conditioned on selections
    p = cfg["prerequisites"]
    if m["avatar-heygen"]["enabled"]:
        p["avatar"]["apiKey"] = _ask("HeyGen API key", p["avatar"]["apiKey"])
    if m["llm"]["enabled"] or m["image-edit-model"]["enabled"]:
        if INTERACTIVE:
            print(" Trainium / Capacity Block:")
        p["capacityBlock"]["reservationId"] = _ask("Capacity Block reservation id", p["capacityBlock"]["reservationId"])
        p["capacityBlock"]["instanceType"] = _ask("CB instance type", p["capacityBlock"]["instanceType"])
        p["capacityBlock"]["az"] = _ask("CB availability zone", p["capacityBlock"]["az"])
        p.setdefault("huggingface", {})
        p["huggingface"]["token"] = _ask("HuggingFace token (optional; faster model downloads, blank = public)", p["huggingface"].get("token", ""))
        if m["llm"]["enabled"]:
            p["models"]["llmS3Path"] = _ask("compiled LLM S3 path (blank = compile)", p["models"]["llmS3Path"])
            cfg["engines"]["llm"]["backends"]["qwen3-neuron"]["enabled"] = True
        if m["image-edit-model"]["enabled"]:
            p["models"]["vtonS3Path"] = _ask("compiled image-edit S3 path (blank = compile)", p["models"]["vtonS3Path"])

    # Engine enables mirror module enables
    cfg["engines"]["vton"]["engines"]["fashn-model"]["enabled"] = m["fashn-model"]["enabled"]
    cfg["engines"]["vton"]["engines"]["image-edit-model"]["enabled"] = m["image-edit-model"]["enabled"]

    with open(args.output, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print(f"\nWrote {args.output}")
    print(f"Next: deploy/storeai plan --config {args.output}   then   deploy/storeai up --config {args.output}")


if __name__ == "__main__":
    main()
