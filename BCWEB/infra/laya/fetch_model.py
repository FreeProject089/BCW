"""One-shot model download for the Laya sidecar (compose service `laya-fetch`, profile `ai`).

Why a separate step: the serving container `laya` sits on an INTERNAL network with no route to
the internet, and runs with HF_HUB_OFFLINE=1. It can reach nobody and nobody outside can reach
it. The checkpoint therefore has to be in the shared `laya-models` volume before it starts, and
this is the only container of the pair that is allowed out, once, to put it there.

It downloads exactly what laya's own loader would (laya/agent.py: the same repository, the same
subfolder, the same allow_patterns, the same revision rule via LAYA_REVISION), so the offline
load that follows finds every file in the cache it expects. A second run with everything
already cached only re-checks the revision and exits.
"""
import os
import sys

from huggingface_hub import snapshot_download
from laya.revisions import resolve_revision
from laya.router import DEFAULT_MODELS

FILES = ("rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*")


def main() -> int:
    names = [n.strip() for n in os.environ.get("LAYA_MODELS", "multilingual").split(",") if n.strip()]
    for name in names:
        if name not in DEFAULT_MODELS:
            print(f"laya-fetch: unknown checkpoint {name!r}", file=sys.stderr)
            return 2
        repo, subfolder = DEFAULT_MODELS[name]
        prefix = f"{subfolder}/" if subfolder else ""
        kw = {"allow_patterns": [prefix + f for f in FILES], "token": os.environ.get("HF_TOKEN") or None}
        revision = resolve_revision(repo)
        if revision:
            kw["revision"] = revision
        path = snapshot_download(repo, **kw)
        print(f"laya-fetch: {name} ready ({repo}{'/' + subfolder if subfolder else ''} @ {os.path.basename(path)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
