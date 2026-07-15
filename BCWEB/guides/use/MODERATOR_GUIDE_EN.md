# The Good Little Moderator — moderating BetterCommunity

*How to keep BetterCommunity (BCWEB) safe and tidy, with the tools and the judgement to
match. Assumes you have a **MOD** (or higher) role. 🇫🇷 [Version française](MODERATOR_GUIDE_FR.md).*

---

## 1. Roles & seniority

BCWEB has a strict role hierarchy. **You can only act on people below you.**

| Role | Can do |
|---|---|
| **USER** | Normal member. |
| **MOD** | Moderate content; **suspend users** (not other staff). |
| **ADMIN** | Everything a MOD can, plus **ban mods**, manage most settings. |
| **SUPERADMIN** | Implicit bypass everywhere; can **ban admins**; sees sensitive-action alerts. |

**Do:** stay within your rank — a MOD suspends *users*, an ADMIN bans *mods*, a SUPERADMIN
bans *admins*. **Don't:** try to act on a peer or a senior; the server refuses it anyway.

## 2. Capabilities

Fine-grained **capabilities** gate each admin surface (e.g. `manage_reports`,
`manage_catalogs`, `manage_repos`, `manage_analytics`). You only see the tabs you're
granted. If a tab is missing, you lack that capability — ask an admin, don't work around it.

## 3. The report queue

- **Admin → Reports** (`/admin?s=reports`) is your inbox. Reports carry a target
  (repo/catalog/profile/post), a reason, and an optional thread with the reporter.
- Filter by **status**; you can suspend the target from here if it's user content.
- Reports can invite participants — keep the conversation factual and on-record.

**Do:** read the whole thread before acting; ask the reporter for specifics if vague.
**Don't:** close a report without a resolution note — the **audit log** keeps you honest.

## 4. Moderating users

- **Suspend** (MOD+) locks a user out with a clear locked-sign-in panel; a suspended user
  **can't resubmit** content. **Ban** (ADMIN+, per the hierarchy) is heavier.
- A user's `User.status` gates access site-wide; the account lock is enforced server-side.

**Recommended escalation:** warn → temporary suspend → ban. Reserve bans for repeat or
severe offenders (malware, targeted harassment, fraud).

## 5. Moderating catalogs & repos

- **Community catalogs** (`manage_catalogs`): suspend / unlist / relist / unlist, and set a
  clear **status** (Online / Offline / Provisioning / Suspended). Examine a catalog's
  contents before acting.
- **Server repos** (`manage_repos`): verify (grant the green check), revalidate, unlist with
  a reason (the owner is notified), and use the **fingerprint lookup** (`BCR-XXXX-XXXX`) to
  tie a repo back to its owner's full identity (BCWEB account + linked BMM/Discord + Ko-fi).
- **Storage pools** (`/admin?s=pools`): view every user's pools; merge / rename / recolour /
  **split** a merged pool when needed.

**Do:** verify only content you've actually inspected — the green check is a trust signal.
**Don't:** unlist without a reason; the owner deserves to know what to fix.

## 6. Access policy (site-wide)

- The **Global Access Policy** (whitelist / ban) layers *on top of* per-repo settings and is
  account-based (BCWEB or Discord id). Use `whitelistOnly` mode sparingly — it locks the
  whole platform to an allow-list.

## 7. The audit trail

- Staff actions are recorded in a **tamper-evident audit log** (HMAC hash chain) with a
  verify endpoint. Sensitive actions alert SUPERADMINs.

**Do:** assume every action is logged and attributable. **Don't:** use DB tools to sidestep
the audit — audit tables are protected.

## 8. Moderator etiquette

- Be transparent, be consistent, and prefer the **least severe** action that solves the
  problem. Undo toasts exist for a reason — a hasty action can often be walked back within
  the window, but not after.

---

### Quick do / don't recap

| ✅ Do | ❌ Don't |
|---|---|
| Act within your rank | Touch peers or seniors |
| Inspect before verifying/suspending | Rubber-stamp the green check |
| Leave a reason + resolution note | Close reports silently |
| Escalate proportionally | Jump straight to a ban |
