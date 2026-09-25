#!/usr/bin/env bash
# The two DAST scanners, run the same way by .github/workflows/dast.yml and by hand.
#
#   .github/scripts/dast-scan.sh templates <dir>   fetch the pinned nuclei-templates into <dir>
#   .github/scripts/dast-scan.sh zap               OWASP ZAP (baseline by default)
#   .github/scripts/dast-scan.sh nuclei            Nuclei, non-intrusive templates only
#
# Run .github/scripts/dast-scope.mjs FIRST. This script does not decide what may be scanned;
# it scans $TARGET, and the scope check is what refuses production.
#
# Environment:
#   TARGET            the URL to scan (already accepted by dast-scope.mjs)
#   REPORTS           directory for the reports (created)
#   DOCKER_NET_ARGS   how the scanner containers reach the target, e.g.
#                     "--network container:edge" (the CI-local instance: the scanner shares the
#                     edge container's network, so `http://localhost` is Caddy with the same Host
#                     the site answers to), or the `sinkhole` output of dast-scope.mjs (staging)
#   ZAP_IMAGE, NUCLEI_IMAGE   pinned images (tag@sha256 digest)
#   ZAP_MODE          baseline (passive rules + spiders, sends no attack) or full (active scan:
#                     attack payloads; the workflow allows it on the CI-local instance only,
#                     unless DAST_ALLOW_ACTIVE_STAGING=true)
#   ZAP_RULES         the reviewed rules file (.github/security/zap-rules.tsv); zap-hooks.py beside it
#                     (or ZAP_HOOK) makes ZAP write zap.sarif.json for code scanning
#   ZAP_SPIDER_MINUTES  traditional spider budget (default 2); the AJAX spider runs too
#   NUCLEI_TEMPLATES  directory holding the pinned templates (from `templates`)
#   NUCLEI_RATE       requests per second (default 100; the staging job passes a lower value)
#   NUCLEI_CONCURRENCY  templates in parallel (default 25)
#   NUCLEI_TEMPLATES_SHA  (templates) the pinned nuclei-templates commit
set -euo pipefail

cmd="${1:-}"

case "$cmd" in
  templates)
    out="${2:?usage: dast-scan.sh templates <dir>}"
    sha="${NUCLEI_TEMPLATES_SHA:?set NUCLEI_TEMPLATES_SHA}"
    rm -rf "$out"
    git init -q "$out"
    git -C "$out" -c core.longpaths=true fetch -q --depth 1 https://github.com/projectdiscovery/nuclei-templates "$sha"
    git -C "$out" -c core.longpaths=true checkout -q FETCH_HEAD
    got="$(git -C "$out" rev-parse HEAD)"
    [ "$got" = "$sha" ] || { echo "::error::nuclei-templates: fetched $got, expected $sha"; exit 1; }
    n="$(find "$out/http" -name '*.yaml' | wc -l)"
    [ "$n" -gt 3000 ] || { echo "::error::nuclei-templates: only $n http templates — the layout changed"; exit 1; }
    echo "nuclei-templates@${sha:0:12}: $n http templates in $out"
    ;;

  zap)
    : "${TARGET:?}" "${REPORTS:?}" "${ZAP_IMAGE:?}" "${ZAP_RULES:?}"
    mode="${ZAP_MODE:-baseline}"
    case "$mode" in
      baseline) script=zap-baseline.py ;;
      full) script=zap-full-scan.py ;;
      *) echo "::error::ZAP_MODE must be baseline or full, not $mode"; exit 2 ;;
    esac
    dir="$REPORTS/zap"
    mkdir -p "$dir"
    # The ZAP image runs as its own user (zap, uid 1000); it must be able to write the reports.
    chmod 0777 "$dir"
    cp "$ZAP_RULES" "$dir/zap-rules.tsv"
    # The hook asks ZAP's own report add-on for a SARIF copy (zap.sarif.json) for code scanning.
    cp "${ZAP_HOOK:-$(dirname "$ZAP_RULES")/zap-hooks.py}" "$dir/zap-hooks.py"
    set +e
    # shellcheck disable=SC2086  # DOCKER_NET_ARGS is a list of docker flags on purpose
    docker run --rm $DOCKER_NET_ARGS -v "$dir:/zap/wrk:rw" "$ZAP_IMAGE" \
      "$script" -t "$TARGET" -m "${ZAP_SPIDER_MINUTES:-2}" -j \
      -c zap-rules.tsv --hook /zap/wrk/zap-hooks.py -J zap.json -r zap.html -w zap.md -I 2>&1 | tee "$dir/zap.log"
    rc="${PIPESTATUS[0]}"
    set -e
    # zap-*.py: 0 = clean, 1 = a FAIL rule hit, 2 = warnings, 3 = ZAP itself failed. The gate
    # decides pass/fail from the report, so 0-2 all mean "the scan ran"; anything else did not.
    case "$rc" in
      0|1|2) ;;
      *) echo "::error::ZAP did not complete (exit $rc); see $dir/zap.log"; exit 1 ;;
    esac
    [ -s "$dir/zap.json" ] || { echo "::error::ZAP wrote no JSON report"; exit 1; }
    [ -s "$dir/zap.sarif.json" ] || echo "::warning::ZAP wrote no SARIF (zap.sarif.json): nothing to upload to code scanning; the gate is unaffected"
    urls="$(grep -Eo 'Total of [0-9]+ URLs' "$dir/zap.log" | tail -1 || true)"
    echo "ZAP $mode finished: ${urls:-URL count not reported}"
    ;;

  nuclei)
    : "${TARGET:?}" "${REPORTS:?}" "${NUCLEI_IMAGE:?}" "${NUCLEI_TEMPLATES:?}"
    dir="$REPORTS/nuclei"
    mkdir -p "$dir"
    chmod 0777 "$dir"
    # Non-destructive only:
    #   -pt http                      web templates only (no network/js/code/headless/file)
    #   -etags dos,fuzz,intrusive,bruteforce,default-login
    #   -et http/fuzzing, http/credential-stuffing   the two folders whose whole point is attack traffic
    #   -ni                           no interactsh: no out-of-band callbacks to a third-party server
    #   -dr                           never follow a redirect off the target
    #   -rl / -c                      bounded rate and concurrency
    #   -duc                          no update check, no template download: the pinned set only
    set +e
    # shellcheck disable=SC2086
    docker run --rm $DOCKER_NET_ARGS -e HOME=/tmp \
      -v "$NUCLEI_TEMPLATES:/templates:ro" -v "$dir:/out" "$NUCLEI_IMAGE" \
      -u "$TARGET" -t /templates/http -pt http \
      -etags dos,fuzz,intrusive,bruteforce,default-login \
      -et /templates/http/fuzzing,/templates/http/credential-stuffing \
      -ni -dr -duc -rl "${NUCLEI_RATE:-100}" -c "${NUCLEI_CONCURRENCY:-25}" -timeout 5 -retries 1 \
      -jle /out/nuclei.jsonl -se /out/nuclei.sarif -or -ot -stats -si 60 -no-color 2>&1 | tee "$dir/nuclei.log"
    rc="${PIPESTATUS[0]}"
    set -e
    [ "$rc" = 0 ] || { echo "::error::nuclei exited $rc; see $dir/nuclei.log"; exit 1; }
    # With no templates nuclei still prints "Scan completed ... No results found" (measured), so
    # the number it loaded is checked, not only its verdict.
    loaded="$(grep -Eo 'Templates loaded for current scan: [0-9]+' "$dir/nuclei.log" | grep -Eo '[0-9]+$' | tail -1 || true)"
    if [ -z "$loaded" ] || [ "$loaded" -lt 1000 ]; then
      echo "::error::nuclei loaded ${loaded:-no} templates; expected thousands — the scan tested nothing"
      exit 1
    fi
    # A target nuclei gave up on (too many errors) is a scan that stopped, not a clean one.
    hostport="$(node -e 'const u=new URL(process.argv[1]);console.log(u.hostname+":"+(u.port||(u.protocol==="https:"?443:80)))' "$TARGET")"
    if grep -qE "Skipped (${hostport}|$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$TARGET")) from target list" "$dir/nuclei.log"; then
      echo "::error::nuclei skipped the target ($hostport) as unresponsive: the scan is incomplete"
      exit 1
    fi
    # Nuclei writes no export when nothing matched. Only a scan that says it COMPLETED may be
    # read as "zero findings"; one that died half-way must not become an empty, green report.
    if ! grep -qE 'Scan completed in|No results found' "$dir/nuclei.log"; then
      echo "::error::nuclei did not report a completed scan; see $dir/nuclei.log"
      exit 1
    fi
    [ -f "$dir/nuclei.jsonl" ] || : > "$dir/nuclei.jsonl"
    grep -E 'Scan completed in|No results found' "$dir/nuclei.log" | tail -1
    ;;

  *)
    echo "usage: dast-scan.sh templates <dir> | zap | nuclei" >&2
    exit 2
    ;;
esac
