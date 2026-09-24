// BetterCommunity's wiring for the markdown kit.
//
// The renderer itself is the `@bettercommunity/bmd` package (packages/bmd) and knows nothing
// about this site: it is a package another project installs, which is the whole point of it having moved. Two things
// it cannot know are supplied here, and nothing else:
//
//   · the two blocks that are React components rather than markup — `:::roadmap` (the project
//     pages' progress tracker) and `:::replay` (the rrweb player the moderation inspector
//     also uses). Without them those blocks say so instead of crashing.
//   · the current language, from this app's i18n provider.
//
// Everything else is re-exported from here so the ~20 files that already import
// `ui/md.jsx` keep working, and so there is exactly one renderer on the site.
import { useEffect, useState } from 'react';
import Markdown from '@bettercommunity/bmd';
// M18 (agent-perf-M18): the kit is configured in md-lite.js (once, early, for the icons too).
import './md-lite.js';
// The hosts live blocks may fetch from (SECURITY_SUMMARY §9): asked once, by the renderer, so a
// page with no markdown never makes the request.
import { loadBmdHosts } from '../lib/bmd-hosts.js';
import { ProgressTracker } from '../hero/progress-tracker.jsx';
import ReplayPlayer from './ReplayPlayer.jsx';
import { useI18n } from '../i18n.jsx';

export {
  ANCHOR_PREFIX, anchorEl, preprocessMd, ICON_NAMES, ShowcaseIcon, appIconKeys, appIconLabel, registerAppIcons, IconGlyph,
  matchesLang, MarkdownConfig, configureMarkdown,
} from '@bettercommunity/bmd';

loadBmdHosts();

export default function SiteMarkdown(props) {
  const { lang } = useI18n();
  // Draw once more when the host list lands: a live block reads the policy while it renders, so
  // one on an allowed host would otherwise keep the "—" it drew under the same-origin default.
  const [, setHostsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadBmdHosts().then(() => { if (alive) setHostsReady(true); });
    return () => { alive = false; };
  }, []);
  return <Markdown lang={lang} roadmap={ProgressTracker} replay={ReplayPlayer} {...props} />;
}
