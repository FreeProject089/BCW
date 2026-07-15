# The Good Little Host — hosting repos & catalogs on BetterCommunity

*How to publish and host your own content on BetterCommunity (BCWEB): server repos,
community catalogs, storage pools and billing — with the tips and the pitfalls.
🇫🇷 [Version française](HOST_GUIDE_FR.md).*

---

## 1. Two ways to publish

- **Server repo** — a mod source. Either **URL-based** (you host the `repo.json` yourself and
  we verify/health-check it) or **hosted by us** (you upload files; we serve `repo.json`).
- **Community catalog** — a curated collection of plugins / themes / apps / presets, served
  as a BMM-native feed (`/c/<slug>/catalog.json`) with per-kind "Add to BMM" deeplinks.

Start from **`/submit`** (Submit content) — it walks you through the official vs.
community paths and the hosting options.

## 2. Storage pools — the core concept

Buying hosting provisions an **empty storage pool**, not a single repo. A pool has a byte
quota; you then fill it with **repos and/or catalogs**, which *share* that space fungibly.

- See your pools in **Dashboard → Server repos → Storage pools**. Each can be **renamed**,
  given its own **colour**, and **collapsed** to declutter.
- Add a repo or a catalog to a pool at any time, drawing from its free space.
- A **single** repo can switch to **multi** (mints a pool sized to its quota) and back.

**Do:** size a pool for what you'll actually store; you can always add more later.
**Don't:** assume a repo has private storage — everything in a pool counts against the pool.

## 3. Merging & splitting pools

- **Merge** several pools into one bigger pool (multi-select → *Merge into…*). Repos,
  catalogs **and the subscriptions** move with them. There's a **6-second undo** toast.
- Merged pools can carry several separate subscriptions. If it makes sense, **consolidate**
  them into one bigger plan — the pool card shows the **savings quote**; the actual switch
  goes through Stripe checkout (only recurring subs are consolidated, so a prepaid term is
  never forfeited).
- An admin can **split** a merged pool back apart if needed.

**Do:** merge related pools to simplify billing and share space. **Don't:** merge across
accounts — pooled storage/subscriptions can't cross owners.

## 4. Billing

- **Prepaid** term (1/3/6/12/24 months, longer = bigger discount) or **auto-renewing**
  monthly. The first `hostingFreeGB` of storage is free; only the excess (plus any extra
  upload/CPU) is billed. **Promo codes** can apply a discount or free hosting.
- Lifecycle: an expiring pool warns you first; a lapse gives a **72-hour grace** before
  repos are suspended and catalogs hidden. Renew (or fix payment) to restore everything.

**Do:** enable auto-renew if the content matters, and watch for the expiry warning.
**Don't:** let a paid term lapse and assume nothing happens — the grace window is short.

## 5. Listing, verification & sharing

- **List publicly** to appear in the browse pages; listed content gets health-checked and a
  mod grants the **verified** green check. A change to a verified repo may re-enter review.
- **Unlisted?** You can still share it: **Copy public share link** mints a
  `/r/<id>?k=<key>` (repos) — anyone with the link sees the page without it being in the
  browse list. Private catalogs work the same way (`/c/<slug>?k=…`).
- Each repo carries a unique **fingerprint** (`BCR-XXXX-XXXX`) tying it to your identity.

**Do:** use a share link for beta/private content. **Don't:** paste a share key in public if
the content is meant to stay unlisted — the key is the gate.

## 6. Sandbox & access control (per repo)

- Owner-editable **sandbox settings**: whitelist / ban by IP, key, or account (BCWEB /
  Discord), and a requested upload limit (always clamped to your plan's hard cap).
- The site-wide **Global Access Policy** is enforced *on top of* your settings — you can't
  widen access beyond what the platform allows.

### Your rules apply to web downloads too

Your repo's page lists its contents and lets people download a file straight from the
browser, without BMM. This is **the same gate**, not a second one — the identical
whitelist/ban check runs whether the request comes from BMM or a browser, and your upload
cap and counters apply either way.

What changes per visitor:

- **Open repo** → anyone can browse and download, signed in or not.
- **Any restriction active** → a signed-out visitor is asked to sign in; we then match their
  BCWEB account *and its linked Discord* against your lists. Your **contents stay hidden**
  from anyone not allowed — a whitelisted repo doesn't leak its file list.
- **Banned** → refused, as everywhere else.

So a member you allow-listed by Discord id can download from the site as long as they've
linked that Discord to their BCWEB account. Nothing to configure: if the repo is open it's
open on the web, and if it's restricted it's restricted on the web.

## 7. Recommended vs. not recommended

**Recommended**
- Keep a real `repo.json` reachable and valid (health checks depend on it).
- Fill in description, tags and links — it's how people trust and find you.
- Use pools to group related content and consolidate billing.
- Rotate a share key if it leaks.

**Not recommended**
- Hosting content you don't have the rights to distribute.
- Over-provisioning "just in case" — you pay for the pool, not what's used.
- Relying on Community trust tier for reach — get verified (Official/Partner) if you can.
- Sharing your dashboard password instead of adding an authorized collaborator email.

---

### Quick do / don't recap

| ✅ Do | ❌ Don't |
|---|---|
| Size pools to real need | Over-provision speculatively |
| Auto-renew important content | Let a term lapse past the 72h grace |
| Share unlisted content via a share link | Leak the share key publicly |
| Add collaborators by email | Hand out the dashboard password |
