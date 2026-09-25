#!/usr/bin/env bash
# Reject, at the runner's firewall, every packet to production — for the rest of the DAST job.
#
#   bash .github/scripts/dast-block-production.sh        (GitHub-hosted Linux runner, sudo)
#
# The second of three independent guards (see .github/workflows/dast.yml). dast-scope.mjs
# already refuses production as a target; this makes sure that nothing in the job — a scanner
# following a link, a redirect, the app under test calling out — can REACH it anyway:
#   · the production VPS, 45.145.164.20, hard-coded;
#   · whatever bettercommunity.ch, www. and telemetry. resolve to right now (A and AAAA);
#   · whatever the names in DAST_DENY_HOSTS resolve to, if that variable is set.
# REJECT in OUTPUT covers the runner itself; DOCKER-USER covers every container, because
# container traffic is forwarded and never crosses OUTPUT.
#
# Resolving a name is a DNS query to the runner's resolver; no packet goes to the addresses.
# Every rule is read back with `-C` before the job continues: a rule that did not land fails
# the job, it is not assumed.
set -euo pipefail

names="bettercommunity.ch www.bettercommunity.ch telemetry.bettercommunity.ch"
for h in $(printf '%s' "${DAST_DENY_HOSTS:-}" | tr ',' ' '); do
  h="${h#\*.}"
  [ -n "$h" ] && names="$names $h"
done

v4="45.145.164.20"
v6=""
for n in $names; do
  a="$(getent ahostsv4 "$n" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
  aaaa="$(getent ahostsv6 "$n" 2>/dev/null | awk '{print $1}' | grep ':' | grep -vi '^::ffff:' | sort -u | tr '\n' ' ' || true)"
  if [ -z "$a$aaaa" ]; then echo "note: $n does not resolve from this runner"; fi
  v4="$v4 $a"
  v6="$v6 $aaaa"
done

block() { # <iptables|ip6tables> <address>
  sudo "$1" -I OUTPUT -d "$2" -j REJECT
  sudo "$1" -C OUTPUT -d "$2" -j REJECT
  if sudo "$1" -n -L DOCKER-USER > /dev/null 2>&1; then
    sudo "$1" -I DOCKER-USER -d "$2" -j REJECT
    sudo "$1" -C DOCKER-USER -d "$2" -j REJECT
  elif [ "$1" = iptables ]; then
    echo "::error::no DOCKER-USER chain: container traffic to $2 could not be blocked"
    exit 1
  fi
}

for ip in $(printf '%s' "$v4" | tr ' ' '\n' | sort -u); do block iptables "$ip"; echo "blocked $ip"; done
for ip in $(printf '%s' "$v6" | tr ' ' '\n' | sort -u); do block ip6tables "$ip"; echo "blocked $ip"; done
