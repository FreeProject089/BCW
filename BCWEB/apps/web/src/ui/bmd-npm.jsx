// The "Published on npm" block for B.MD's two packages, shared by /dev/bmd, /dev/editor and
// the B.MD card on /dev.
//
// @bettercommunity/bmd and @bettercommunity/bmd-editor went to npm on 2026-09-29 (3.1.0), from
// BCW/.github/workflows/publish-bmd.yml, with provenance. Everything shown here is read AT
// BUILD TIME from each package.json (name, version, licence): nothing asks the registry from
// the browser, and there is no badge image from a third-party host. The site CSP allows
// neither, and a version typed by hand here is the one that goes stale at the next release.
//
// The provenance link points at the npm page's own Provenance section: npm shows there which
// workflow run built the tarball and from which commit, and that is what "verified" means.
import { Package, ShieldCheck, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Button, Badge } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { SnippetTabs } from './dev-snippet.jsx';
import { name as BMD_NAME, version as BMD_VERSION, license as BMD_LICENSE } from '../../../../packages/bmd/package.json';
import { name as ED_NAME, version as ED_VERSION, license as ED_LICENSE, peerDependencies as ED_PEERS } from '../../../../packages/bmd-editor/package.json';

const npmUrl = (name) => `https://www.npmjs.com/package/${name}`;

export const BMD_PACKAGES = {
  bmd: { name: BMD_NAME, version: BMD_VERSION, license: BMD_LICENSE, npm: npmUrl(BMD_NAME) },
  editor: { name: ED_NAME, version: ED_VERSION, license: ED_LICENSE, npm: npmUrl(ED_NAME), peer: ED_PEERS?.[BMD_NAME] || '' },
};

/** npm / pnpm / yarn / bun, for one or several package names. */
export function installTabs(names) {
  const list = names.join(' ');
  return [
    { id: 'npm', label: 'npm', code: `npm i ${list}` },
    { id: 'pnpm', label: 'pnpm', code: `pnpm add ${list}` },
    { id: 'yarn', label: 'yarn', code: `yarn add ${list}` },
    { id: 'bun', label: 'bun', code: `bun add ${list}` },
  ];
}

/** One package: name, version, licence, install for every client, npm, provenance. */
export function NpmPackageCard({ pkg, install = null, children = null }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-[var(--line)] p-4 min-w-0 flex flex-col gap-3" style={{ background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="font-mono font-semibold text-[13.5px] break-all">{pkg.name}</code>
        <Badge tone="green"><CheckCircle2 size={11} className="inline -mt-px" /> {t('bmdpub.published', 'Published on npm')}</Badge>
        <Badge>v{pkg.version}</Badge>
        <Badge>{pkg.license}</Badge>
      </div>
      <SnippetTabs tabs={install || installTabs([pkg.name])} />
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <a href={pkg.npm} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="primary"><Package size={13} /> {t('bmdpub.view', 'View on npm')} <ExternalLink size={11} /></Button></a>
      </div>
      <p className="text-[12px] text-[var(--muted)] flex items-start gap-1.5">
        <ShieldCheck size={14} className="text-[var(--accent-ink)] shrink-0 mt-px" />
        <span>
          <a className="text-[var(--accent-ink)] underline" href={`${pkg.npm}#provenance`} target="_blank" rel="noopener noreferrer">{t('bmdpub.prov', 'Verified provenance (built by GitHub Actions)')}</a>
          {' '}{t('bmdpub.prov.d', 'npm shows which workflow run built this version, and from which commit.')}
        </span>
      </p>
    </div>
  );
}

/**
 * The header block: both packages side by side; the editor's card installs the two together.
 * `only="editor"` keeps the editor's card alone (the /dev/editor page).
 */
export function BmdNpmBlock({ only = null, className = '' }) {
  const { t } = useI18n();
  const both = installTabs([BMD_PACKAGES.bmd.name, BMD_PACKAGES.editor.name]);
  const editor = (
    <NpmPackageCard pkg={BMD_PACKAGES.editor} install={both}>
      <p className="text-[12px] text-[var(--muted)]">
        {t('bmdpub.ed.peer', 'Installs with {peer} beside it: the renderer is a peer, so your site keeps one copy of it.').replace('{peer}', `${BMD_PACKAGES.bmd.name} ${BMD_PACKAGES.editor.peer}`)}
      </p>
    </NpmPackageCard>
  );
  // Alone (/dev/editor), the page's own lede already names the peer: no second copy of it.
  if (only === 'editor') return <div className={`min-w-0 ${className}`}><NpmPackageCard pkg={BMD_PACKAGES.editor} install={both} /></div>;
  return (
    <div className={`grid md:grid-cols-2 gap-3 min-w-0 ${className}`}>
      <NpmPackageCard pkg={BMD_PACKAGES.bmd} />
      {editor}
    </div>
  );
}

/**
 * The same facts, small enough for the B.MD card on /dev: both packages with their version and
 * an npm link, the install line for every client, and the provenance link.
 */
export function BmdNpmCompact() {
  const { t } = useI18n();
  const { bmd, editor } = BMD_PACKAGES;
  return (
    <div className="mt-3 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="green"><CheckCircle2 size={11} className="inline -mt-px" /> {t('bmdpub.published', 'Published on npm')}</Badge>
        <Badge>{bmd.license}</Badge>
      </div>
      <ul className="text-[12px] space-y-0.5">
        {[bmd, editor].map((p) => (
          <li key={p.name} className="flex items-center gap-1.5 min-w-0">
            <a href={p.npm} target="_blank" rel="noopener noreferrer" title={p.name} className="font-mono text-[var(--accent-ink)] hover:underline truncate">{p.name}</a>
            <span className="text-[var(--muted)] shrink-0">v{p.version}</span>
          </li>
        ))}
      </ul>
      <SnippetTabs tabs={installTabs([bmd.name])} />
      <a className="text-[11px] text-[var(--accent-ink)] underline inline-flex items-center gap-1" href={`${bmd.npm}#provenance`} target="_blank" rel="noopener noreferrer">
        <ShieldCheck size={12} className="shrink-0" /> {t('bmdpub.prov', 'Verified provenance (built by GitHub Actions)')}
      </a>
    </div>
  );
}
