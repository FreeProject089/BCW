# Changelog

## 2.0.0 — 2026-09-06

The kit becomes a package: `packages/bmd` with `package.json`, `exports`, `docs/`, this file.
`apps/web` reads it in place (Vite alias + `resolve.dedupe`); the `/dev/markdown` zip is unchanged.

### Added
- `:::timeline` / `:::event[Title]{date= state=done|now|next icon= color=}` (`:::moment` alias).
- `:::compare{before= after=}` with `:::before` / `:::after` sides.
- `:::stats` / `:::stat[Label]{value= delta= icon= color=}` (`:::kpi` alias) — the delta's sign colours it.
- `:::quote[Author]{role= avatar= href= color=}` (`:::testimonial` alias).
- `:::hero[Title]{subtitle= image= icon= color= align=}`.
- `:::changelog` / `:::version[1.4.0]{date= label=}` (`:::release` alias).
- `:::spoiler[Reveal]` — a `<details>`, no script.
- `:::faq[Title]` / `:::q[Question]{open}` (`:::question` alias).
- `:::checklist[Title]` — counts the `- [x]` items and draws a bar.
- `:::grid{cols=1..6 gap=sm|lg}`.
- `:meter[60]{label= max= color=}` — inline progress.
- **Phosphor icons**: `ph:name`, `ph-thin:` / `ph-light:` / `ph-bold:` / `ph-fill:` / `ph-duotone:`; `cdn.phosphor` in the config (null switches the family off); `phosphorRef()` exported.
- Types: `registerAppIcons`, `appIconLabel`, `phosphorRef` declared; `cdnIconUrl` accepts `'phosphor'`.

### Unchanged
- Every 1.x directive, class name and attribute. Existing documents render identically.

## 1.x

The copy-the-folder era (`apps/web/src/markdown`): 48 directives, the roadmap and replay
components, the URL policy, the sanitiser, the plugin hook, the TypeScript declarations.
