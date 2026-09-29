# Laya sidecar (agent-laya-bcweb): convaiinnovations/laya-multilingual behind `laya-serve`, on CPU.
#
# The OPTIONAL AI provider for BCWEB's moderation (apps/api/src/lib/moderation/ai.mjs). It runs
# as its own container precisely so the model never lives in the API process: the API talks to
# it over HTTP (POST /v1/systemone, Bearer LAYA_API_KEY) with a deadline, a queue and a circuit
# breaker, and treats every failure as "no AI". Started only with the compose profile `ai`
# (infra/compose/docker-compose.yml), on an internal network with no published port and no
# route out. The same image runs twice there: `laya-fetch` (one-shot, fetch_model.py, the only
# one allowed to reach Hugging Face) fills the model volume, then `laya` serves it offline.
#
# Sizes (measured from the Hugging Face listing, revision e4e9ddf2…, 2026-09-29):
#   model.safetensors 644 MB + tokenizer 34 MB  ≈ 0.7 GB, downloaded ONCE by `laya-fetch` into
#   the `laya-models` volume (HF_HOME), not baked into the image: the image stays scannable and
#   rebuildable, and a rebuild does not re-download the model.
#   Image: python slim + CPU-only torch + transformers, roughly 1 to 1.5 GB. The default torch
#   wheel from PyPI bundles CUDA and weighs several GB more for nothing on a CPU server.
#   RAM once loaded: about 1.5 GB (322M parameters). The compose limit is 2 GB.
#
# NOT BUILT OR RUN BY THE AUTHOR OF THIS FILE: no image was built and no model downloaded while
# writing it (guides/run/AI_LAYA_EN.md, "What was verified"). Build it once by hand before you
# rely on it: `docker compose --profile ai build laya`.

# python:3.12-slim-bookworm, pinned by tag AND digest (the index digest, 2026-09-29). Bump both
# together: `docker buildx imagetools inspect python:3.12-slim-bookworm`.
FROM python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/hf \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu \
    LAYA_MODELS=multilingual \
    LAYA_MAX_LOADED=1 \
    LAYA_THREADS=2 \
    LAYA_PRELOAD=1 \
    LAYA_MAX_CONCURRENT=2 \
    LAYA_MAX_TOKEN_BUDGET=1024 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    TOKENIZERS_PARALLELISM=false

# CPU-only torch FIRST, from PyTorch's CPU index, so `laya` (torch>=2.0) finds it satisfied and
# pip never fetches the CUDA build. Then laya with its HTTP server extra, pinned. The resolved
# set is written to /opt/laya-freeze.txt so a scan or an audit can read exactly what shipped.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.9.1" \
 && pip install --no-cache-dir "laya[serve]==0.3.21" \
 && pip freeze > /opt/laya-freeze.txt

# Non-root. /models is the volume laya-fetch downloads the model into.
RUN useradd --uid 10001 --user-group --create-home --home-dir /home/laya --shell /usr/sbin/nologin laya \
 && mkdir -p /models/hf \
 && chown -R laya:laya /models
COPY --chown=root:root --chmod=0644 healthcheck.py fetch_model.py entrypoint.py /opt/
USER laya
WORKDIR /home/laya

EXPOSE 8000
# The start period covers loading ~0.7 GB from the volume into memory on a slow disk.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 CMD ["python", "/opt/healthcheck.py"]
# followups (agent-bcw-followups): LAYA_API_KEY is mandatory. entrypoint.py refuses to start
# any command of this image without it (laya-fetch too, which runs first), then execs the command.
ENTRYPOINT ["python", "/opt/entrypoint.py"]
CMD ["laya-serve"]
