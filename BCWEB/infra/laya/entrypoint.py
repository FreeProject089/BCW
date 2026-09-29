"""Entrypoint of the Laya sidecar image (followups, agent-bcw-followups): no key, no start.

LAYA_API_KEY is mandatory under the compose profile `ai`. Without it the sidecar used to answer
anyone on its network; now it refuses to start, with a line in `docker compose logs` saying
why, and the API's Laya provider reports itself "unconfigured" (apps/api/src/lib/moderation/
ai.mjs). The check runs for every command of this image, `laya-fetch` included: the one-shot
fetch runs first under the same profile, and the `laya` service waits for it to succeed, so a
missing key stops the profile at its first step instead of a server that restarts forever.

The key is read from the environment and never printed. Only its presence and length are
checked: a placeholder copied from .env.example is refused too.
"""
import os
import sys

MIN_LEN = 16
PLACEHOLDERS = {"change-me", "changeme", "<openssl rand -hex 32>", "your-key-here"}

# Image defaults whose NAMES contain "token", set here rather than as Dockerfile ENV: Trivy's
# DS-0031 ("secrets passed via build-args or envs") judges an ENV by its name, and neither of
# these is a secret. An ENV-level ignore would also hide a real secret added to that Dockerfile
# later, so the defaults moved instead (agent-bcw-sec-red, 2026-09-29). setdefault: a value
# from compose (LAYA_MAX_TOKEN_BUDGET: "1024") or `docker run -e` still wins.
#   LAYA_MAX_TOKEN_BUDGET  laya-serve's per-request max_len cap (its own default is 8192).
#   TOKENIZERS_PARALLELISM Hugging Face tokenizers: no thread pool of its own next to torch's.
IMAGE_DEFAULTS = {"LAYA_MAX_TOKEN_BUDGET": "1024", "TOKENIZERS_PARALLELISM": "false"}


def key_problem(env):
    key = (env.get("LAYA_API_KEY") or "").strip()
    if not key:
        return "LAYA_API_KEY is not set"
    if key.lower() in PLACEHOLDERS:
        return "LAYA_API_KEY is still the placeholder from .env.example"
    if len(key) < MIN_LEN:
        return f"LAYA_API_KEY is shorter than {MIN_LEN} characters"
    return None


def main(argv):
    problem = key_problem(os.environ)
    if problem:
        sys.stderr.write(
            f"laya: refusing to start: {problem}. The compose profile `ai` needs the same key "
            "in the API and in this sidecar: put LAYA_API_KEY=$(openssl rand -hex 32) in .env "
            "(guides/run/AI_LAYA_EN.md).\n"
        )
        return 64  # EX_USAGE: a configuration error, not a crash
    for name, value in IMAGE_DEFAULTS.items():
        os.environ.setdefault(name, value)
    cmd = argv[1:] or ["laya-serve"]
    os.execvp(cmd[0], cmd)
    return 0  # not reached


if __name__ == "__main__":
    sys.exit(main(sys.argv))
