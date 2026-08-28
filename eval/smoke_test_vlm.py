#!/usr/bin/env python3
"""
SIH26171 — VLM Smoke Test
Run this after the model is pulled to verify the endpoint is working.

Usage:
    python eval/smoke_test_vlm.py

Reports:
    - Text-only response and latency
    - Multimodal response and latency
    - JSON structure validity
    - Pass / Fail verdict
"""

import base64
import json
import sys
import time
import urllib.request
import urllib.error

ENDPOINT = "http://localhost:11434/v1/chat/completions"
MODEL    = "qwen2.5vl:7b"
IMAGE    = "src/icons/icon128.png"   # small PNG already in the repo

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"


def post(payload: dict) -> tuple[dict, float]:
    """POST to ENDPOINT, return (response_json, elapsed_ms)."""
    body = json.dumps(payload).encode()
    req  = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
    except urllib.error.URLError as e:
        print(f"\n[ERROR] Could not reach {ENDPOINT}: {e}")
        print("Is Ollama running?  Run: ollama serve")
        sys.exit(1)
    elapsed = (time.monotonic() - t0) * 1000
    return data, elapsed


def check_shape(data: dict) -> bool:
    """Verify the response has choices[0].message.content."""
    try:
        content = data["choices"][0]["message"]["content"]
        return isinstance(content, str) and len(content.strip()) > 0
    except (KeyError, IndexError, TypeError):
        return False


# ── Test 1: Text-only ─────────────────────────────────────────────

print("\n" + "="*60)
print("TEST 1 — Text-only smoke test")
print("="*60)

payload_text = {
    "model": MODEL,
    "messages": [{"role": "user", "content": "Say the word READY and nothing else."}],
    "max_tokens": 10,
    "temperature": 0.1,
}

data_text, ms_text = post(payload_text)
content_text = data_text.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

print(f"Response : {repr(content_text)}")
print(f"Latency  : {ms_text:.0f} ms")
print(f"Shape OK : {check_shape(data_text)}")

t1_ok = check_shape(data_text) and "READY" in content_text.upper()
print(f"Result   : {PASS if t1_ok else FAIL}")


# ── Test 2: Multimodal ────────────────────────────────────────────

print("\n" + "="*60)
print("TEST 2 — Multimodal smoke test (image + text)")
print("="*60)

try:
    with open(IMAGE, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    print(f"Image    : {IMAGE}")
except FileNotFoundError:
    print(f"[WARN] {IMAGE} not found — skipping multimodal test")
    img_b64 = None

if img_b64:
    payload_mm = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                {"type": "text",      "text": "Describe this image in one sentence."},
            ],
        }],
        "max_tokens": 64,
        "temperature": 0.1,
    }

    data_mm, ms_mm = post(payload_mm)
    content_mm = data_mm.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

    print(f"Response : {repr(content_mm)}")
    print(f"Latency  : {ms_mm:.0f} ms")
    print(f"Shape OK : {check_shape(data_mm)}")

    t2_ok = check_shape(data_mm) and len(content_mm) > 5
    print(f"Result   : {PASS if t2_ok else FAIL}")
else:
    ms_mm   = None
    t2_ok   = False
    content_mm = "(skipped)"


# ── Summary ───────────────────────────────────────────────────────

print("\n" + "="*60)
print("SUMMARY")
print("="*60)
print(f"  Text-only latency  : {ms_text:.0f} ms   [{PASS if t1_ok else FAIL}]")
if ms_mm is not None:
    print(f"  Multimodal latency : {ms_mm:.0f} ms   [{PASS if t2_ok else FAIL}]")
print(f"  Endpoint            : {ENDPOINT}")
print(f"  Model               : {MODEL}")

all_pass = t1_ok and (t2_ok if img_b64 else True)
print(f"\nOverall  : {PASS if all_pass else FAIL}")

if not all_pass:
    sys.exit(1)
