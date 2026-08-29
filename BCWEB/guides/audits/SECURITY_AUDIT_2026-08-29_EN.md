# CVE / CWE audit — 2026-08-29

Across BMM (Tauri + Rust), BetterInstaller (Slint + Rust), and BCWEB (Node + Rust addon).

The list is short. What is worth reading is the reasoning under each entry, because four of
the six findings are advisories with **no upgrade available**, and "no fix upstream" is where
an audit either does real work or writes a row and moves on.

## What was fixed

| Component | Advisory | Was | Now |
|---|---|---|---|
| BMM | RUSTSEC-2026-0258 — `h2` unbounded empty DATA frames | h2 0.4.15 | **0.4.19** |
| BetterInstaller | RUSTSEC-2026-0230 — `webbrowser` Unix `BROWSER` argument injection | webbrowser 1.2.1 | **1.2.4** |

The `webbrowser` one is the only finding in this pass that is not a resource-exhaustion
issue. On Unix the crate honoured `$BROWSER` in a way that let its value inject arguments
into the spawned command. BetterInstaller opens URLs from its own UI, so the value would have
to come from the environment the installer runs in rather than from a document it reads —
but that is a mitigation, not a reason to stay on the old version when a fixed one exists.

## What is not fixable, and why each one is survivable

### `sevenz-rust` 0.6.1 — RUSTSEC-2026-0245, CVSS 8.3, CWE-23/CWE-36

Path traversal in `decompress_impl`: an entry named `../../evil.dll` is written where it
says. No fixed version upstream, and this is the highest-scored finding in the set.

**BMM does not rely on the crate for this.** `archive.rs::extract_to` enumerates the archive
index first and refuses the whole file if any entry would escape the destination, before
decompression runs. The same guard covers `.rar`, whose crate makes the same promise.

It is tested — `path_safety_tests::an_entry_that_could_escape_the_destination_is_refused`
names this advisory in its own comment and covers thirteen escape shapes, including the
Windows ones a POSIX-minded guard misses: `..\`, `C:\`, a bare drive letter, and a UNC path.

### `rsa` 0.10.0-rc.18 — RUSTSEC-2023-0071, CVSS 5.9

The Marvin attack: a timing sidechannel that can recover a key through repeated
**decryption** oracles. No fixed version exists.

It arrives through `russh` (and `ssh-key`), which BMM uses for SSH publishing. Two things
bound it. RSA in an SSH client is used to **sign** an authentication challenge, not to
decrypt attacker-chosen ciphertext, which is the shape the attack needs. And BMM's own
identity proofs are **ed25519 only** — a deliberate refusal documented in `repo_keyauth.rs`,
made so that both verifiers (Rust and Node) accept exactly one algorithm.

An owner who authenticates SSH with an RSA key is using RSA to sign, against a server they
chose. That is not the oracle.

### `h2` 0.3.27 — RUSTSEC-2026-0258

The same advisory as the fixed one, on the other copy in the tree. This one comes through
`warp` → `hyper 0.14`, which pins the 0.3 series; there is no upgrade without replacing the
HTTP server.

It is a denial of service against the server that receives the frames. BMM's is the **local
plugin API**: it binds 127.0.0.1, every route requires the token, and an attacker who can
reach it is already running code on the machine. Replacing warp to fix a DoS reachable only
from localhost would be a large change against a small risk.

### `quick-xml` 0.39.4 — two advisories, CVSS 7.5 each (BetterInstaller)

Quadratic parsing and unbounded namespace allocation. `cargo update` locks zero packages
here, and the reason is the useful part: it is a **build-time proc-macro dependency** of
`wayland-scanner`, pulled in by Slint's winit backend, and only on Linux. It parses the
Wayland protocol XML that ships with the build, at compile time. There is no runtime path and
no attacker-supplied input; the Windows target does not include it at all.

`wayland-scanner` pins `0.39`, so the upgrade is upstream's to make.

## Unmaintained crates

`atk`, `gdk`, `gtk` and friends (GTK3 bindings), `bincode`, `event-listener`, `glib`,
`chacha20` (yanked). All warnings rather than vulnerabilities, and all transitive through the
GUI toolchains. Recorded so the next audit does not re-derive them, not acted on.

## The dependency scans that are clean

```
BCWEB apps/api    npm audit → 0
BCWEB apps/web    npm audit → 0
BCWEB apps/bot    npm audit → 0
BMM   frontend    npm audit → 0
BCWEB native      cargo audit → 0
```

## The other half of this pass

An audit that only reads a lockfile misses the things a lockfile cannot see. Two came out of
this session's own work and are worth recording as findings:

**BMM's CI ran five checks out of sixty-seven.** BMM's own gate chain — `npm --prefix ../.. run ci`
from the BCWEB root, since it belongs to the BetterModsManager repository and not to any
workspace in this one — is what that project is measured against; its GitHub workflow ran
three of its scripts, plus `tsc`, plus `cargo check`. Among the sixty-two it skipped:
`check-dev-toggles`, which refuses a commit
shipping the developer's localhost-pointing BetterCommunity config to every user — and one
such commit got through this week while the workflow was green. The workflow now runs the
chain, and `cargo check` became `cargo test` (414 of them, previously never run in CI).

**A capability gated by a verb rather than by a policy.** `state_bridge::api_call`, the MCP
bridge, refuses PUT and DELETE. It reads like a safety boundary and is not one: MCP already
deletes mods, launch packs and scheduled tasks through its own paths, which never touch that
function. The real boundary is the API's per-route `require_permission` scopes. Left as it
is — widening it is the owner's call, and the harness classifier refused the change, which is
the correct reflex for anything that widens what an agent may do on somebody's machine.

## How to repeat this

```bash
# Rust
cd src-tauri            && cargo audit
cd BetterInstaller      && cargo audit
cd BCW/BCWEB/native     && cargo audit

# Node
cd BCW/BCWEB/apps/api   && npm audit
cd BCW/BCWEB/apps/web   && npm audit
cd BCW/BCWEB/apps/bot   && npm audit
```

`cargo audit` reports advisories against `Cargo.lock`, so it sees what is actually built —
including transitive crates a `Cargo.toml` never names. Read `cargo tree -i <crate>` before
believing any of them applies: four of the six above are reachable only through a build
script, a localhost socket, or a code path this repository does not take.
