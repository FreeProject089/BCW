// agent-bcw-pools: Admin > Hosting > Pools per project.
//
// A project (official or other) can have ONE pool of its own. Everything the project stores
// then counts against that pool: the repos and catalogues placed in it, its pre-release files,
// its shop files and its blog. A project with no pool keeps the site's own limits. The API
// refuses a pool too small for what the project already stores (routes/project-pools.mjs).
import { useState } from 'react';
import { HardDrive, Link2, Unlink } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Select, Explain, EmptyState, Spinner, useToast, formatBytes } from '../ui/ui.jsx';

export function AdminProjectPools() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/hosting/project-pools'), []);
  const [pick, setPick] = useState({}); // ref -> pool id chosen in the select
  const [busy, setBusy] = useState('');
  const projects = data?.projects || [];
  const pools = data?.pools || [];
  const freePools = pools.filter((g) => !g.projectTarget);

  const attach = async (ref) => {
    const id = pick[ref];
    if (!id) return;
    setBusy(ref);
    try {
      await api.put(`/admin/hosting/pools/${id}/project`, { ref });
      toast.success(t('app.attached', 'Pool attached. This project now stores its files there.'));
      reload();
    } catch (x) {
      const e = x?.data || {};
      toast.error(e.error === 'pool_too_small'
        ? t('app.small', 'Too small: the project already stores {n}, the pool has {f} free.').replace('{n}', formatBytes(e.needBytes || 0)).replace('{f}', formatBytes(e.freeBytes || 0))
        : e.error === 'project_has_pool' ? t('app.has', 'This project already has a pool.') : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };
  const detach = async (proj) => {
    setBusy(proj.ref);
    try {
      await api.put(`/admin/hosting/pools/${proj.pool.id}/project`, { ref: null });
      toast.success(t('app.detached', 'Detached. The project is back on the site limits.'));
      reload();
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4" data-testid="admin-project-pools">
      <div className="flex items-center gap-2 flex-wrap">
        <HardDrive size={16} className="text-[var(--accent-ink)]" />
        <h2 className="font-semibold">{t('app.title', 'Pools per project')}</h2>
      </div>
      <Explain summary={t('app.lead', 'Give a project its own pool: all its files count there.')} className="text-[12px]">
        {t('app.body', 'Repos and catalogues placed in the pool, pre-release files, shop files and the blog. Without a pool, a project keeps the site limits. Create the pool first under Storage pools, or sell one with a payment link.')}
      </Explain>
      <Card className="overflow-hidden">
        {loading && !data ? <div className="py-10 text-center"><Spinner /></div> : !projects.length ? (
          <div className="p-2"><EmptyState icon={HardDrive} title={t('app.empty', 'No project yet')} sub={t('app.empty.s', 'Projects appear here as soon as they exist.')} /></div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {projects.map((proj) => (
              <li key={proj.ref} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm">
                <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <span className="block truncate font-medium" title={proj.name}>{proj.name}</span>
                  <span className="block text-[12px] text-[var(--muted)] truncate">
                    {proj.pool
                      ? t('app.usage', '{p}: {u} of files, {f} free of {s}').replace('{p}', proj.pool.name).replace('{u}', formatBytes(proj.pool.files.total)).replace('{f}', formatBytes(proj.pool.freeBytes || 0)).replace('{s}', formatBytes(proj.pool.poolBytes))
                      : t('app.none', 'Site limits')}
                  </span>
                </span>
                {!proj.official && <Badge>{t('app.other', 'other project')}</Badge>}
                {proj.pool ? (
                  <Button size="sm" variant="ghost" disabled={busy === proj.ref} onClick={() => detach(proj)}><Unlink size={13} /> {t('app.detach', 'Detach')}</Button>
                ) : (
                  <span className="flex items-center gap-2 min-w-0">
                    <Select className="!w-auto max-w-[14rem]" value={pick[proj.ref] || ''} onChange={(e) => setPick({ ...pick, [proj.ref]: e.target.value })} aria-label={t('app.pick', 'Pool for {n}').replace('{n}', proj.name)}>
                      <option value="">{t('app.pick0', 'Choose a pool')}</option>
                      {freePools.map((g) => <option key={g.id} value={g.id}>{`${g.name} (${formatBytes(g.freeBytes)} / ${formatBytes(g.poolBytes)})`}</option>)}
                    </Select>
                    <Button size="sm" disabled={!pick[proj.ref] || busy === proj.ref} onClick={() => attach(proj.ref)}><Link2 size={13} /> {t('app.attach', 'Attach')}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default AdminProjectPools;
