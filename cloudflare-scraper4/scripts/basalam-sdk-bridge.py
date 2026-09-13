#!/usr/bin/env python3
"""Bridge between the Node/Worker code and the official Basalam Python SDK.

Basalam only publishes an SDK for Python (``pip install basalam-sdk``); there is
no npm package, so the JavaScript "SDK first" path could never actually use it.
This script is spawned with a single JSON document on stdin and prints a single
JSON document on stdout, which lets the TypeScript code try the real SDK first
and fall back to the REST API when Python or the SDK is unavailable.

Request:
    {"action": "create"|"update"|"probe",
     "token": "...", "refreshToken": "...",
     "vendorId": 123, "productId": 456,
     "payload": { ...ProductRequestSchema fields... }}

Response:
    {"ok": true,  "id": 987, "transport": "sdk", "sdkVersion": "1.2.0"}
    {"ok": false, "error": "...", "code": "sdk-missing"|"auth"|"api"|"bad-request"}

Exit code is always 0 when a JSON answer was produced: the caller distinguishes
success from failure with the "ok" field, not the process status.
"""
import sys
import json


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(0)


def fail(error, code="error"):
    respond({"ok": False, "error": str(error), "code": code})


def sdk_version():
    try:
        from importlib.metadata import version

        return version("basalam-sdk")
    except Exception:
        return ""


def main():
    try:
        raw = sys.stdin.read()
    except Exception as exc:  # pragma: no cover - stdin is supplied by the caller
        fail("cannot read stdin: %s" % exc, "bad-request")
    if not raw.strip():
        fail("empty request", "bad-request")
    try:
        req = json.loads(raw)
    except Exception as exc:
        fail("invalid JSON request: %s" % exc, "bad-request")

    try:
        from basalam_sdk import BasalamClient, PersonalToken
    except Exception as exc:
        # The single most common case: the SDK is not installed. The caller
        # treats this as "fall back to the REST API", not as a hard failure.
        fail(
            "basalam-sdk is not installed for %s (%s). Install it with: pip install basalam-sdk"
            % (sys.executable, exc),
            "sdk-missing",
        )

    action = str(req.get("action") or "").lower()
    if action == "probe":
        respond({"ok": True, "transport": "sdk", "sdkVersion": sdk_version(),
                 "python": sys.version.split()[0], "executable": sys.executable})

    token = req.get("token") or ""
    if not token:
        fail("missing Basalam access token", "auth")

    try:
        auth = PersonalToken(token=token, refresh_token=req.get("refreshToken") or "")
        client = BasalamClient(auth=auth)
    except Exception as exc:
        fail("cannot build Basalam client: %s" % exc, "auth")

    payload = req.get("payload") or {}
    if not isinstance(payload, dict):
        fail("payload must be an object", "bad-request")

    try:
        from basalam_sdk.core.models import ProductRequestSchema
    except Exception as exc:
        fail("basalam-sdk is missing ProductRequestSchema: %s" % exc, "sdk-missing")

    # Only forward the fields this SDK version actually declares, otherwise a
    # newer scraper payload would make pydantic reject the whole request.
    try:
        allowed = set(getattr(ProductRequestSchema, "model_fields", {}) or {})
        if not allowed:
            allowed = set(getattr(ProductRequestSchema, "__fields__", {}) or {})
        clean = {k: v for k, v in payload.items() if not allowed or k in allowed}
        request = ProductRequestSchema(**clean)
    except Exception as exc:
        fail("payload rejected by ProductRequestSchema: %s" % exc, "bad-request")

    try:
        if action == "update":
            product_id = int(req.get("productId") or 0)
            if not product_id:
                fail("missing productId for update", "bad-request")
            result = client.update_product_sync(product_id=product_id, request=request)
        elif action == "create":
            vendor_id = int(req.get("vendorId") or 0)
            if not vendor_id:
                fail("missing vendorId for create", "bad-request")
            result = client.create_product_sync(vendor_id=vendor_id, request=request)
        else:
            fail("unknown action: %s" % action, "bad-request")
    except Exception as exc:
        fail("Basalam SDK call failed: %s" % exc, "api")

    remote_id = 0
    for attr in ("id", "product_id", "productId"):
        value = getattr(result, attr, None)
        if value is None and isinstance(result, dict):
            value = result.get(attr)
        try:
            if value is not None:
                remote_id = int(value)
                break
        except Exception:
            continue

    respond({"ok": True, "id": remote_id, "transport": "sdk", "sdkVersion": sdk_version()})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - last-resort guard
        fail("unexpected bridge error: %s" % exc)
