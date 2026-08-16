// The code map, on the project's own page.
//
// It has lived behind an editor session in the developer tools — the one place a reader of the
// project page will never be. Same snapshot, read only, for anybody looking at the project.
//
// Loaded on demand rather than with the page: the map carries every file, every proven call and
// a source excerpt per flow step, which is a lot of JSON to hand somebody who came to read the
// changelog. The button is also the consent: nobody downloads a repository's shape by accident.
import { useState } from 'react';
import { Network } from 'lucide-react';
import { api } from '../lib/api.js';
import CodeMap from './code-map.jsx';

export default function ProjectCodeMap({ projectKey, t = (k, d) => d }) {
    const [graph, setGraph] = useState(null);
    const [state, setState] = useState('idle');     // idle | loading | none | failed

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

    if (graph) {
        return (
            <div className="mt-8">
                <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <Network size={15} className="text-[var(--primary-2)]" /> {t('pmap.title', 'The code itself')}
                </h3>
                <p className="text-[12px] text-[var(--muted)] mb-3">
                    {t('pmap.sub', 'Read from the repository. Every line is an import or a call that exists in the source — nothing is inferred from a name, and nothing about what the code does is described.')}
                    {graph.generatedAt ? ` ${t('pmap.asof', 'As of')} ${new Date(graph.generatedAt).toLocaleDateString()}.` : ''}
                </p>
                <CodeMap graph={graph} t={t} />
            </div>
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
