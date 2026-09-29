"""Docker HEALTHCHECK for the Laya sidecar: GET /health on the loopback, with the bearer key
when one is set (laya-serve may protect every route with LAYA_API_KEY). Exit 0 = healthy.
The key is read from the environment and never printed."""
import os
import sys
import urllib.request

port = os.environ.get("LAYA_PORT", "8000")
req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
key = os.environ.get("LAYA_API_KEY", "").strip()
if key:
    req.add_header("Authorization", f"Bearer {key}")
try:
    with urllib.request.urlopen(req, timeout=4) as res:  # noqa: S310 (fixed loopback URL)
        sys.exit(0 if res.status == 200 else 1)
except Exception:  # any failure is "not healthy", never a crash of the check itself
    sys.exit(1)
