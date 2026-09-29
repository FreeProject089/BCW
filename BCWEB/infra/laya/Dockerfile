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
# Hardened 2026-09-29 (agent-bcw-sec-red) after the "BCWEB security" run 36599887997 failed on
# this image (Trivy: 5 CRITICAL + ~60 HIGH, almost all Debian 12 packages with no fix, plus
# setuptools 78.1.0 / jaraco.context 5.3.0 / wheel 0.45.1) and on this file (DS-0031):
#   - Debian 13 (trixie) instead of 12, the base pinned by tag AND digest;
#   - two stages: pip, its caches and the install happen in `build`; the runtime gets the
#     finished virtualenv and no pip at all (neither the venv's nor the base image's);
#   - the runtime purges every Debian package the service never runs (perl, bash, ncurses,
#     readline, util-linux/mount/login, apt, PAM, systemd/udev libs, gzip…): see the list below;
#   - setuptools pinned from PyPI to a release whose vendored jaraco.context / wheel are fixed
#     (the PyTorch index only mirrors 78.1.0, which torch pulls in on Python 3.12);
#   - no ENV named like a secret (DS-0031 reads the NAME: LAYA_MAX_TOKEN_BUDGET and
#     TOKENIZERS_PARALLELISM matched "token"): entrypoint.py sets those two defaults instead.
# What is still reported and why it is accepted: .github/security/trivyignore.yaml (laya block).
#
# Verified 2026-09-29: built with `docker build --pull`, scanned with the pinned Trivy and
# judged by .github/scripts/security-gate.mjs exactly as .github/workflows/security.yml does;
# in the built image, the entrypoint key check (exit 64 without LAYA_API_KEY), the imports of
# laya/torch/transformers, and `laya-serve` started (uid 10001, cap_drop ALL, no network, no
# preload) with its HEALTHCHECK answering. The model itself was NOT downloaded nor served (see
# guides/run/AI_LAYA_EN.md, "What was verified"): `docker compose --profile ai up` once by hand
# before you rely on it.

# python:3.12-slim-trixie, pinned by tag AND digest (the index digest, 2026-09-29). Both stages
# MUST use the same one: the venv's python is a symlink to /usr/local/bin/python3.12 of the base.
# Bump both lines together: `docker buildx imagetools inspect python:3.12-slim-trixie`.
FROM python:3.12-slim-trixie@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# CPU-only torch FIRST, from PyTorch's CPU index, so `laya` (torch>=2.0) finds it satisfied and
# pip never fetches the CUDA build. Then laya with its HTTP server extra, pinned. Then
# setuptools from PyPI: torch requires it on Python 3.12 (only torch.utils.cpp_extension uses
# it, never at inference), and 84.0.0 is the first pin checked to vendor jaraco.context 6.1.0
# and wheel 0.46.3 (CVE-2026-23949, CVE-2026-24049, CVE-2025-47273 fixed). The resolved set is
# written to /opt/laya-freeze.txt so a scan or an audit can read exactly what shipped;
# pip is then removed from the venv (nothing installs anything at runtime).
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.9.1" \
 && /opt/venv/bin/pip install "laya[serve]==0.3.21" \
 && /opt/venv/bin/pip install "setuptools==84.0.0" \
 && /opt/venv/bin/pip freeze --all > /opt/laya-freeze.txt \
 && /opt/venv/bin/pip uninstall -y pip \
 && find /opt/venv -name __pycache__ -type d -prune -exec rm -rf {} +

# ── runtime ──────────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim-trixie@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/laya \
    HF_HOME=/models/hf \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu \
    LAYA_MODELS=multilingual \
    LAYA_MAX_LOADED=1 \
    LAYA_THREADS=2 \
    LAYA_PRELOAD=1 \
    LAYA_MAX_CONCURRENT=2 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

# As root, once: the non-root user and the volume mount point (uid 10001, as before, so an
# existing `laya-models` volume stays writable), then the attack-surface cut.
#   - The base image's own pip (and ensurepip's bundled wheels) go: the service never installs.
#   - dpkg --purge of what neither python nor torch loads and no command of this image runs:
#     shells and text tools (bash, perl, ncurses, readline), mount/login/util-linux and their
#     libs (libmount, libblkid, libuuid, libsmartcols, liblastlog2: Python's uuid module falls
#     back to its pure-Python code without libuuid), apt and its keyring/verifier, PAM,
#     passwd/adduser (the user exists already), systemd/udev client libs, gdbm/db (dbm module),
#     gzip, hostname, sysvinit-utils, and debconf (perl scripts). --force-remove-essential and
#     -protected because Debian marks several of them Essential for interactive systems; this
#     container is not one. Two passes: the removal scripts of PAM and login run debconf, which
#     runs perl, so they go before perl. dash, coreutils, dpkg, tar and the libraries Python
#     links stay (a few coreutils login-accounting tools such as `who` lose libsystemd; nothing
#     here runs them).
#   - The import check at the end fails the build if the cut removed anything Python needs.
RUN set -eu; \
    useradd --uid 10001 --user-group --create-home --home-dir /home/laya --shell /usr/sbin/nologin laya; \
    mkdir -p /models/hf; \
    chown -R laya:laya /models; \
    rm -rf /usr/local/bin/pip /usr/local/bin/pip3* /usr/local/lib/python3.12/site-packages/pip \
           /usr/local/lib/python3.12/site-packages/pip-*.dist-info /usr/local/lib/python3.12/ensurepip; \
    purge() { dpkg --purge --force-remove-essential --force-remove-protected --force-depends "$@"; }; \
    purge login login.defs passwd adduser libpam-modules libpam-modules-bin libpam-runtime libpam0g \
      libsemanage2 libsemanage-common libaudit1 libaudit-common libcap-ng0; \
    purge perl-base debconf bash ncurses-bin ncurses-base libncursesw6 libtinfo6 libreadline8t64 \
      readline-common util-linux mount bsdutils libsmartcols1 liblastlog2-2 libmount1 libblkid1 \
      libuuid1 libudev1 libsystemd0 libseccomp2 apt libapt-pkg7.0 sqv debian-archive-keyring \
      sysvinit-utils init-system-helpers libgdbm6t64 libdb5.3t64 gzip hostname; \
    rm -rf /var/lib/apt /var/cache/apt /var/cache/debconf/*-old /var/log/*; \
    python -c "import ssl, ctypes, lzma, bz2, zlib, sqlite3, uuid, hashlib, json"

COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/laya-freeze.txt /opt/laya-freeze.txt
COPY --chown=root:root --chmod=0644 healthcheck.py fetch_model.py entrypoint.py /opt/
USER 10001:10001
WORKDIR /home/laya

EXPOSE 8000
# The start period covers loading ~0.7 GB from the volume into memory on a slow disk.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 CMD ["python", "/opt/healthcheck.py"]
# followups (agent-bcw-followups): LAYA_API_KEY is mandatory. entrypoint.py refuses to start
# any command of this image without it (laya-fetch too, which runs first), then execs the command.
ENTRYPOINT ["python", "/opt/entrypoint.py"]
CMD ["laya-serve"]
