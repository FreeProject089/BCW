// The code map, on the project's own page.
//
// It has lived behind an editor session in the developer tools — the one place a reader of the
// project page will never be. Same snapshot, read only, for anybody looking at the project.
//
// It is NOT loaded with the page — the map carries every file, every proven call and a source
// excerpt per flow step, which is a lot of JSON to hand somebody who came to read the
// changelog. It is loaded when this component mounts, and this component only mounts inside
// the tab called "How it runs".
//
// That used to be a button, and the button was the consent: "nobody downloads a repository's
// shape by accident". Clicking a tab named How it runs is not an accident. The reader had
// already asked, and was answered with a five-box diagram and an invitation to ask again —
// which is what made the whole tab feel like a placeholder. The button remains as the way
// back after a failure.
import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { api } from '../lib/api.js';
import CodeMap from './code-map.jsx';

export default function ProjectCodeMap({ projectKey, t = (k, d) => d }) {
    const [graph, setGraph] = useState(null);
    const [state, setState] = useState('loading');  // idle | loading | none | failed

    const load = async () => {
        setState('loading');
        try {
            const r = await api.get(`/projects/${projectKey}/code-map`);
            setGraph(r);
            setState('idle');
        } catch (e) {
            // 404 is the normal answer for a project whose repository has never been read, and
            // it is not an error to shout about — it is simply "there is nothing yet".
            setState(e?.status === 404 ? 'none' : 'failed');
        }
    };

    // Once, on mount. `projectKey` is in the deps so switching project reloads, and the guard
    // is the graph itself: a re-render must not re-fetch a map that is already on screen.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const r = await api.get(`/projects/${projectKey}/code-map`);
                if (alive) { setGraph(r); setState('idle'); }
            } catch (e) {
                if (alive) setState(e?.status === 404 ? 'none' : 'failed');
            }
        })();
        return () => { alive = false; };
    }, [projectKey]);

    if (graph) {
        return (
            <div className="mt-8">
                <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <Network size={15} className="text-[var(--primary-2)]" /> {t('pmap.title', 'The code itself')}
                </h3>
                {/* The admin's own words first, then what the map is. Their sentence is
                    about THIS repository; the standing explanation is about every map. */}
                {graph.note && <p className="text-[13px] mb-2 leading-relaxed">{graph.note}</p>}
                <p className="text-[12px] text-[var(--muted)] mb-3">
                    {t('pmap.sub', 'Read from the repository. Every line is an import or a call that exists in the source — nothing is inferred from a name, and nothing about what the code does is described.')}
                    {graph.generatedAt ? ` ${t('pmap.asof', 'As of')} ${new Date(graph.generatedAt).toLocaleDateString()}.` : ''}
                    {/* Disclosed, without naming what was left out. A reader comparing this
                        to the repository would otherwise conclude the scan is broken. */}
                    {graph.hiddenCount > 0 && ` ${t('pmap.hidden', '{n} path(s) are deliberately not published.').replace('{n}', String(graph.hiddenCount))}`}
                </p>
                <CodeMap graph={graph} t={t} />
            </div>
        );
    }

    // Nothing to publish is not a failure and must not look like one: a project whose
    // repository has never been read says so quietly and takes up one line.
    if (state === 'none') {
        return <p className="mt-8 text-[12px] text-[var(--faint)]">{t('pmap.none', 'This project has not been read yet.')}</p>;
    }
    if (state === 'loading') {
        return (
            <p className="mt-8 text-[12px] text-[var(--muted)] inline-flex items-center gap-2">
                <Network size={14} className="text-[var(--primary-2)]" /> {t('pmap.loading', 'Reading the map…')}
            </p>
        );
    }

    return (
        <div className="mt-8">
            <button type="button" onClick={load} disabled={state === 'loading'}
                className="text-[13px] px-3 py-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition inline-flex items-center gap-2">
                <Network size={14} />
                {state === 'loading' ? t('pmap.loading', 'Reading the map…') : t('pmap.open', 'Show the code map')}
            </button>
            {state === 'none' && (
                <p className="text-[12px] text-[var(--faint)] mt-2">{t('pmap.none', 'This project has not been read yet.')}</p>
            )}
            {state === 'failed' && (
                <p className="text-[12px] text-[var(--warning)] mt-2">{t('pmap.failed', 'The map could not be loaded.')}</p>
            )}
        </div>
    );
}
