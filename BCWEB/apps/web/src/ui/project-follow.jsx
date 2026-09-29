// notify (agent-notify): "Follow" on a project page.
//
// Following means one thing: a new post in this project's blog lands in your notifications
// (kind project_post, the "Projects you follow" category you can switch off in
// /notifications). The server decides whether the project may be followed at all
// (GET /project-follow/:ref answers 404 for a page you cannot see), so this draws nothing
// until it has asked.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellPlus, BellRing } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { Button, useToast } from './ui.jsx';

export function ProjectFollowButton({ projectRef }) {
  const { t } = useI18n(); const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!projectRef) return undefined;
    let alive = true;
    api.get(`/project-follow/${encodeURIComponent(projectRef)}`).then((r) => { if (alive) setS(r); }).catch(() => { if (alive) setS(null); });
    return () => { alive = false; };
  }, [projectRef, !!user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;

  const toggle = async () => {
    if (!user) { nav(`/auth?next=${encodeURIComponent(window.location.pathname)}`); return; }
    const next = !s.following;
    setBusy(true);
    setS((x) => ({ ...x, following: next, followers: Math.max(0, (x.followers || 0) + (next ? 1 : -1)) }));
    try {
      const r = await api.put(`/project-follow/${encodeURIComponent(projectRef)}`, { follow: next });
      setS((x) => ({ ...x, following: r.following, followers: r.followers }));
      toast.success(next
        ? t('pfollow.on', 'Following. New posts from this project will reach your notifications.')
        : t('pfollow.off', 'You no longer follow this project.'));
    } catch {
      setS((x) => ({ ...x, following: !next }));
      toast.error(t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <Button onClick={toggle} disabled={busy} aria-pressed={s.following}
      title={s.following ? t('pfollow.unfollow.h', 'Stop following this project') : t('pfollow.follow.h', 'Get a notification when this project publishes a post')}>
      {s.following ? <BellRing size={15} /> : <BellPlus size={15} />}
      {s.following ? t('pfollow.following', 'Following') : t('pfollow.follow', 'Follow')}
      {s.followers > 0 && <span className="text-[var(--muted)] tabular-nums ms-1">{s.followers}</span>}
    </Button>
  );
}

export default ProjectFollowButton;
// fin notify (agent-notify)
