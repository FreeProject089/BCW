// Staff: one search box over everything the dashboard holds.
//
//   GET /admin/search?q=   → { groups: [{ kind, label, items: [{ id, title, sub, href }] }] }
//
// Each group is only searched — and only returned — when the caller holds the capability
// that guards its screen, so the box never shows a name from a section the person could
// not open. Case- and accent-tolerant on the database side as far as `contains` allows
// (accent folding happens in the client's ranking); every group is capped so a one-letter
// query cannot pull the tables through the API.
import { db, requireRole, hasCap } from '../lib/lib.mjs';

const TAKE = 6;
const safe = (v, n = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);

export default async function adminSearchRoutes(app) {
  app.get('/admin/search', { preHandler: requireRole('MOD', 'ADMIN', 'SUPERADMIN') }, async (req) => {
    const q = String(req.query?.q || '').trim().slice(0, 80);
    if (q.length < 2) return { groups: [] };
    const p = await db();
    const u = req.user;
    const admin = u.role === 'ADMIN' || u.role === 'SUPERADMIN';
    const ci = { contains: q, mode: 'insensitive' };
    const groups = [];
    const run = async (kind, label, allowed, fn) => {
      if (!allowed) return;
      try {
        const items = await fn();
        if (items.length) groups.push({ kind, label, items });
      } catch { /* one table failing must not empty the box */ }
    };

    await run('users', 'Accounts', hasCap(u, 'manage_users'), async () => (await p.user.findMany({
      where: { OR: [{ displayName: ci }, { email: ci }, { id: q }] }, take: TAKE, select: { id: true, displayName: true, email: true, status: true, role: true },
    })).map((x) => ({ id: x.id, title: safe(x.displayName), sub: `${safe(x.email)} · ${x.role}${x.status !== 'active' ? ` · ${x.status}` : ''}`, href: `/admin?s=users&q=${encodeURIComponent(x.id)}` })));

    await run('repos', 'Server repos', hasCap(u, 'manage_repos'), async () => (await p.serverRepo.findMany({
      where: { OR: [{ name: ci }, { description: ci }, { id: q }] }, take: TAKE, select: { id: true, name: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.name), sub: String(x.status), href: `/admin?s=repos&q=${encodeURIComponent(x.name)}` })));

    await run('catalogs', 'Community catalogues', hasCap(u, 'manage_catalogs') || admin, async () => (await p.communityCatalog.findMany({
      where: { OR: [{ name: ci }, { slug: ci }, { description: ci }] }, take: TAKE, select: { id: true, name: true, slug: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.name), sub: `/${x.slug} · ${x.status}`, href: `/admin?s=commcatalogs&q=${encodeURIComponent(x.name)}` })));

    await run('teams', 'Teams', hasCap(u, 'manage_users'), async () => (await p.team.findMany({
      where: { OR: [{ name: ci }, { slug: ci }] }, take: TAKE, select: { id: true, name: true, slug: true },
    })).map((x) => ({ id: x.id, title: safe(x.name), sub: `/${x.slug}`, href: `/t/${encodeURIComponent(x.slug)}` })));

    await run('threads', 'Conversations', hasCap(u, 'manage_reports'), async () => (await p.contactThread.findMany({
      where: { OR: [{ subject: ci }, { targetLabel: ci }] }, take: TAKE, orderBy: { updatedAt: 'desc' }, select: { id: true, subject: true, kind: true, status: true, targetLabel: true },
    })).map((x) => ({ id: x.id, title: safe(x.subject || x.targetLabel), sub: `${x.kind} · ${x.status}`, href: `/admin?s=messages&thread=${encodeURIComponent(x.id)}` })));

    await run('reports', 'Reports', hasCap(u, 'manage_reports'), async () => (await p.report.findMany({
      where: { OR: [{ targetLabel: ci }, { reason: ci }] }, take: TAKE, orderBy: { createdAt: 'desc' }, select: { id: true, targetLabel: true, targetType: true, reason: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.targetLabel || x.targetType), sub: `${safe(x.reason, 40)} · ${x.status}`, href: `/admin?s=reports&q=${encodeURIComponent(x.id)}` })));

    await run('sanctions', 'Sanctions', hasCap(u, 'manage_sanctions') || hasCap(u, 'manage_users'), async () => (await p.sanction.findMany({
      where: { OR: [{ code: ci }, { reason: ci }, { userId: q }] }, take: TAKE, orderBy: { createdAt: 'desc' }, select: { id: true, code: true, kind: true, status: true, reason: true },
    })).map((x) => ({ id: x.id, title: `${x.code} · ${x.kind}`, sub: `${safe(x.reason, 50)} · ${x.status}`, href: `/admin?s=sanctions&q=${encodeURIComponent(x.code)}` })));

    await run('myo', 'Commissions', hasCap(u, 'manage_myo'), async () => (await p.myoRequest.findMany({
      where: { OR: [{ name: ci }, { description: ci }] }, take: TAKE, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.name), sub: x.status, href: `/admin?s=myo&q=${encodeURIComponent(x.id)}` })));

    await run('posts', 'Blog posts', hasCap(u, 'manage_announcements') || hasCap(u, 'manage_projects') || admin, async () => (await p.blogPost.findMany({
      where: { OR: [{ title: ci }, { slug: ci }, { excerpt: ci }] }, take: TAKE, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, slug: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.title), sub: `${x.status}`, href: `/blog/${encodeURIComponent(x.slug)}` })));

    await run('docs', 'Docs', hasCap(u, 'manage_docs') || admin, async () => (await p.docPage.findMany({
      where: { OR: [{ title: ci }, { slug: ci }] }, take: TAKE, select: { id: true, title: true, slug: true },
    })).map((x) => ({ id: x.id, title: safe(x.title), sub: `/docs/${x.slug}`, href: `/docs/${encodeURIComponent(x.slug)}` })));

    await run('faq', 'FAQ', hasCap(u, 'manage_faq'), async () => (await p.faqItem.findMany({
      where: { OR: [{ question: ci }, { questionFr: ci }, { answer: ci }] }, take: TAKE, select: { id: true, question: true },
    })).map((x) => ({ id: x.id, title: safe(x.question), sub: 'FAQ', href: `/admin?s=faq&q=${encodeURIComponent(x.id)}` })));

    await run('polls', 'Polls', hasCap(u, 'manage_polls'), async () => (await p.poll.findMany({
      where: { OR: [{ question: ci }, { description: ci }] }, take: TAKE, select: { id: true, question: true, status: true },
    })).map((x) => ({ id: x.id, title: safe(x.question), sub: x.status, href: `/admin?s=polls&q=${encodeURIComponent(x.id)}` })));

    await run('promo', 'Promo codes', hasCap(u, 'manage_promotions'), async () => (await p.promoCode.findMany({
      where: { code: ci }, take: TAKE, select: { id: true, code: true, kind: true },
    })).map((x) => ({ id: x.id, title: x.code, sub: x.kind, href: `/admin?s=promotions&q=${encodeURIComponent(x.code)}` })));

    await run('showcase', 'Other projects', admin, async () => (await p.showcaseProject.findMany({
      where: { OR: [{ name: ci }, { slug: ci }] }, take: TAKE, select: { id: true, name: true, slug: true },
    })).map((x) => ({ id: x.id, title: safe(x.name), sub: `/${x.slug}`, href: `/admin?s=showcase&q=${encodeURIComponent(x.slug)}` })));

    return { groups };
  });
}
