import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useToast, Button, Spinner, Modal, EmptyState, Input, Textarea, Select } from './ui.jsx';
import { useI18n } from './i18n.jsx';
import UserAvatar from './Avatar.jsx';
import Markdown from './md.jsx';
import { MarkdownEditor } from './blog.jsx';
import DiffMergeModal from './diff-merge-modal.jsx';
import { MessageSquare, CornerDownRight, Check, Pencil, Trash2, Send, Tag, Globe, Lock, Hash, History, Clock, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

// Strip markdown to a short plain-text preview for a collapsed thread's one-liner.
const plainPreview = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`_~\[\]!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

// Heading anchor slug — must match the docs/blog renderer (md.jsx) so a comment pinned
// to a section can scroll to it.
const headingSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
// Pull the ## / ### headings out of a markdown body → pickable section list.
const extractSections = (md) => [...new Set((String(md || '').match(/^#{2,3}\s+.+$/gm) || [])
  .map((h) => h.replace(/^#{2,3}\s+/, '').replace(/[*_`]/g, '').trim()).filter(Boolean))].slice(0, 60);

const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
// Real avatar: author.avatar is the saved descriptor { variant, seed, colors, image }.
const CAvatar = ({ a }) => <UserAvatar user={{ id: a?.author?.id, displayName: a?.author?.name, avatar: a?.author?.avatar }} size={24} className="shrink-0" />;

// A single comment (or reply). MODULE-SCOPE on purpose: when it was defined inside the
// modal it was a new component type every render, so React remounted it — and the edit /
// reply editors lost focus after each keystroke ("letter by letter"). `ctx` carries the
// handlers/state so identity stays stable and inputs keep focus.
function CommentBody({ c, isReply, ctx }) {
  const { canWrite, editing, setEditing, busy, saveEdit, setReplyTo, replyTo, replyBody, setReplyBody, reply, toggleResolved, del, onJump, onClose, openHistory } = ctx;
  const edited = c.edited || c.updatedAt !== c.createdAt;
  return (
    <div className={`${c.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <CAvatar a={c} />
        <span className="text-sm font-medium">{c.author?.name}</span>
        <span className="text-[11px] text-[var(--faint)]">{fmt(c.createdAt)}</span>
        {edited && <button onClick={() => openHistory(c.id)} title="View this comment's edit history" className="text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-0.5 underline decoration-dotted"><History size={10} /> edited</button>}
        {c.resolved && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 flex items-center gap-0.5"><Check size={10} /> resolved</span>}
        {c.participants?.length > 1 && (
          <span className="flex items-center -space-x-1.5 ml-auto" title={`Contributors: ${c.participants.map((u) => u.name).join(', ')}`}>
            {c.participants.slice(0, 5).map((u) => (
              <UserAvatar key={u.id} user={{ id: u.id, displayName: u.name, avatar: u.avatar }} size={18} className="ring-1 ring-[var(--avatar-ring)] rounded-full" />
            ))}
            {c.participants.length > 5 && <span className="text-[10px] text-[var(--faint)] pl-2">+{c.participants.length - 5}</span>}
          </span>
        )}
      </div>
      {c.anchor && !isReply && (onJump
        ? <button onClick={() => { onJump(headingSlug(c.anchor)); onClose(); }} title="Jump to this section" className="ml-8 mt-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary-2)] hover:bg-[var(--primary)]/20 transition"><Hash size={10} /> {c.anchor}</button>
        : <div className="ml-8 mt-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary-2)]"><Hash size={10} /> {c.anchor}</div>)}
      {editing?.id === c.id ? (
        <div className="ml-8 mt-1.5">
          <MarkdownEditor value={editing.body} onChange={(v) => setEditing({ ...editing, body: v })} full minHeight={120} placeholder="Edit comment — supports blocks, tables, images…" />
          <div className="flex gap-1.5 mt-1.5"><Button size="sm" variant="primary" disabled={busy} onClick={saveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="ml-8 mt-1 text-sm comment-md"><Markdown>{c.body}</Markdown></div>
      )}
      {canWrite && editing?.id !== c.id && (
        <div className="ml-8 mt-1 flex items-center gap-3 text-[11px] text-[var(--faint)]">
          {!isReply && <button className="hover:text-[var(--text)] flex items-center gap-1" onClick={() => { setReplyTo(c.id); setReplyBody(''); }}><CornerDownRight size={11} /> Reply</button>}
          <button className="hover:text-[var(--text)] flex items-center gap-1" onClick={() => setEditing({ id: c.id, body: c.body, base: c.body })}><Pencil size={11} /> Edit</button>
          {!isReply && <button className="hover:text-emerald-400 flex items-center gap-1" onClick={() => toggleResolved(c)}><Check size={11} /> {c.resolved ? 'Unresolve' : 'Resolve'}</button>}
          <button className="hover:text-red-400 flex items-center gap-1" onClick={() => del(c.id)}><Trash2 size={11} /> Delete</button>
        </div>
      )}
      {replyTo === c.id && (
        <div className="ml-8 mt-2 flex gap-1.5">
          <Input value={replyBody} autoFocus onChange={(e) => setReplyBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(c.id); } }} placeholder="Reply…" className="!py-1.5 !text-sm" />
          <Button size="sm" variant="primary" disabled={busy} onClick={() => reply(c.id)}><Send size={13} /></Button>
        </div>
      )}
    </div>
  );
}

// Threaded editor-collaboration comments for a blog post (PR-review style). Any editor
// can read, add, reply, resolve, and EDIT any comment. `base` = `/blog/<id>`. `body` (the
// post/page markdown) powers the "pin to a section" picker + click-to-jump. `onJump(slug)`
// (optional) lets the reader scroll to a section when a pin is clicked.
export default function CommentsModal({ base, onClose, readOnly, body, onJump }) {
  const toast = useToast(); const { t } = useI18n();
  const [data, setData] = useState(null); // { comments, canComment, commentsPublic }
  const [draft, setDraft] = useState({ body: '', anchor: '' });
  const [customAnchor, setCustomAnchor] = useState(false); // "Custom…" chosen in the picker
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [editing, setEditing] = useState(null); // { id, body, base }
  const [conflict, setConflict] = useState(null); // { id, base, mine, theirs } — concurrent-edit merge
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null); // { id, revisions } — a comment's edit history
  const [collapsed, setCollapsed] = useState(() => new Set()); // root ids whose thread is folded
  const sections = useMemo(() => extractSections(body), [body]);
  const toggleCollapse = (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openHistory = async (id) => {
    setHistory({ id, revisions: null });
    try { const r = await api.get(`${base}/comments/${id}/history`); setHistory({ id, revisions: r.revisions || [] }); }
    catch { setHistory({ id, revisions: [] }); }
  };

  const load = () => api.get(`${base}/comments`).then(setData).catch(() => setData({ comments: [], canComment: false }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [base]);

  const canWrite = !readOnly && data?.canComment;
  const roots = (data?.comments || []).filter((c) => !c.parentId);
  const repliesOf = (id) => (data?.comments || []).filter((c) => c.parentId === id);

  const add = async () => {
    if (!draft.body.trim()) return;
    setBusy(true);
    try { await api.post(`${base}/comments`, { body: draft.body.trim(), anchor: draft.anchor.trim() || null }); setDraft({ body: '', anchor: '' }); await load(); }
    catch { toast.error(t('cm.postfail', 'Could not post the comment.')); } finally { setBusy(false); }
  };
  const reply = async (parentId) => {
    if (!replyBody.trim()) return;
    setBusy(true);
    try { await api.post(`${base}/comments`, { body: replyBody.trim(), parentId }); setReplyTo(null); setReplyBody(''); await load(); }
    catch { toast.error(t('cm.replyfail', 'Could not reply.')); } finally { setBusy(false); }
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      // Send the base we started from so the server can detect a concurrent edit.
      await api.patch(`${base}/comments/${editing.id}`, { body: editing.body, baseBody: editing.base ?? editing.body });
      setEditing(null); await load();
    } catch (e) {
      if (e?.status === 409 && e?.data?.error === 'comment_conflict') {
        // Someone else edited this comment meanwhile → open the 3-way merge resolver.
        setConflict({ id: editing.id, base: editing.base ?? '', mine: editing.body, theirs: e.data.current?.body ?? '' });
      } else toast.error(t('cm.savefail', 'Could not save.'));
    } finally { setBusy(false); }
  };
  // Save the merged result of a resolved conflict, re-basing on the version we merged against.
  const resolveConflict = async (merged) => {
    const c = conflict; setConflict(null); setBusy(true);
    try { await api.patch(`${base}/comments/${c.id}`, { body: merged, baseBody: c.theirs }); setEditing(null); await load(); }
    catch (e) {
      if (e?.status === 409 && e?.data?.error === 'comment_conflict') setConflict({ id: c.id, base: c.theirs, mine: merged, theirs: e.data.current?.body ?? '' });
      else toast.error(t('cm.mergefail', 'Could not save the merge.'));
    } finally { setBusy(false); }
  };
  const toggleResolved = async (c) => { try { await api.patch(`${base}/comments/${c.id}`, { resolved: !c.resolved }); await load(); } catch { toast.error(t('be.failed', 'Failed.')); } };
  const del = async (id) => { try { await api.del(`${base}/comments/${id}`); await load(); } catch { toast.error(t('be.failed', 'Failed.')); } };

  // Handlers/state handed to the module-scope CommentBody (keeps its identity stable so
  // edit/reply inputs don't lose focus — see the note on CommentBody).
  const ctx = { canWrite, editing, setEditing, busy, saveEdit, replyTo, setReplyTo, replyBody, setReplyBody, reply, toggleResolved, del, onJump, onClose, openHistory };
  const fmtFull = (d) => { try { return new Date(d).toLocaleString(); } catch { return ''; } };

  return (
    <Modal open onClose={onClose} title="Comments" icon={MessageSquare} width="max-w-2xl"
      footer={<>
        <span className="text-xs mr-auto flex items-center gap-1.5 text-[var(--faint)]">
          {data?.commentsPublic ? <><Globe size={13} className="text-emerald-400" /> Visible to readers</> : <><Lock size={13} /> Editors only</>}
        </span>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {data === null ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <>
          {/* When a page has many discussion threads, let editors fold them (per-thread
              chevron, or collapse/expand all) so the list stays scannable on any screen. */}
          {roots.length > 1 && (
            <div className="flex items-center justify-between gap-2 mb-2.5 text-xs text-[var(--muted)]">
              <span>{roots.length} {t('cm.threads', 'threads')}</span>
              {collapsed.size >= roots.length
                ? <button onClick={() => setCollapsed(new Set())} className="press-sm inline-flex items-center gap-1 hover:text-[var(--text)]"><ChevronsUpDown size={13} /> {t('cm.expandall', 'Expand all')}</button>
                : <button onClick={() => setCollapsed(new Set(roots.map((c) => c.id)))} className="press-sm inline-flex items-center gap-1 hover:text-[var(--text)]"><ChevronsDownUp size={13} /> {t('cm.collapseall', 'Collapse all')}</button>}
            </div>
          )}
          <div className="space-y-3 max-h-[58vh] overflow-y-auto scroll-thin pr-1">
            {roots.length === 0 && <EmptyState icon={MessageSquare} title="No comments yet" sub={canWrite ? 'Start the discussion below.' : 'Nothing here yet.'} />}
            {roots.map((c) => {
              const isCol = collapsed.has(c.id);
              const replies = repliesOf(c.id);
              return (
                <div key={c.id} className="rounded-xl border border-[var(--line)] p-3">
                  <div className="flex items-start gap-2">
                    <button onClick={() => toggleCollapse(c.id)} className="press-sm mt-0.5 text-[var(--faint)] hover:text-[var(--text)] shrink-0" title={isCol ? t('cm.expand', 'Expand') : t('cm.collapse', 'Collapse')} aria-label={isCol ? t('cm.expand', 'Expand') : t('cm.collapse', 'Collapse')}>
                      <ChevronRight size={15} className={`transition-transform ${isCol ? '' : 'rotate-90'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      {isCol ? (
                        <button onClick={() => toggleCollapse(c.id)} className="w-full text-left flex items-center gap-2">
                          <CAvatar a={c} />
                          <span className="text-sm font-medium shrink-0">{c.author?.name}</span>
                          <span className="text-[11px] text-[var(--faint)] truncate flex-1 min-w-0">{plainPreview(c.body) || '—'}</span>
                          {c.resolved && <Check size={11} className="text-emerald-400 shrink-0" />}
                          {replies.length > 0 && <span className="text-[11px] text-[var(--faint)] shrink-0 flex items-center gap-0.5"><CornerDownRight size={10} /> {replies.length}</span>}
                        </button>
                      ) : (<>
                        <CommentBody c={c} ctx={ctx} />
                        {replies.length > 0 && (
                          <div className="ml-3 sm:ml-4 mt-3 pl-2.5 sm:pl-3 border-l-2 border-[var(--line)] space-y-3">
                            {replies.map((r) => <CommentBody key={r.id} c={r} isReply ctx={ctx} />)}
                          </div>
                        )}
                      </>)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {canWrite && (
        <div className="mt-4 pt-3 border-t border-[var(--line)]">
          {/* Link to a section — pick from the content's headings (or type a custom pin).
              Much simpler than remembering the exact heading text. */}
          <div className="flex items-center gap-2 mb-1.5">
            <Hash size={13} className="text-[var(--faint)] shrink-0" />
            {sections.length && !customAnchor ? (
              <Select className="!py-1.5 !text-sm flex-1" value={draft.anchor}
                onChange={(e) => { if (e.target.value === '__custom__') { setCustomAnchor(true); setDraft({ ...draft, anchor: '' }); } else setDraft({ ...draft, anchor: e.target.value }); }}>
                <option value="">No section (general comment)</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value="__custom__">Custom pin…</option>
              </Select>
            ) : (
              <div className="flex-1 flex items-center gap-1.5">
                <Input value={draft.anchor} autoFocus={customAnchor} onChange={(e) => setDraft({ ...draft, anchor: e.target.value })} placeholder="Pin to a section/line (optional)" className="!py-1.5 !text-sm" />
                {sections.length > 0 && <button className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] whitespace-nowrap" onClick={() => { setCustomAnchor(false); setDraft({ ...draft, anchor: '' }); }}>sections</button>}
              </div>
            )}
          </div>
          <MarkdownEditor value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} full minHeight={110} placeholder="Leave a comment — use the Blocks button for cards, tables, images, video…" />
          <div className="flex justify-end mt-1.5"><Button size="sm" variant="primary" disabled={busy || !draft.body.trim()} onClick={add}><Send size={14} /> Comment</Button></div>
        </div>
      )}
      {/* A single comment's edit history — every version (newest first) with who + when.
          Nothing is lost when a comment is collaboratively edited. */}
      {history && (
        <Modal open onClose={() => setHistory(null)} title="Comment history" icon={History} width="max-w-lg"
          footer={<Button variant="ghost" onClick={() => setHistory(null)}>Close</Button>}>
          {history.revisions === null ? <div className="grid place-items-center py-8"><Spinner /></div>
            : history.revisions.length ? (
              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                {history.revisions.map((r, i) => (
                  <div key={r.id} className="rounded-lg border border-[var(--line)] p-3">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--faint)] mb-1.5">
                      <Clock size={11} /> {fmtFull(r.createdAt)}
                      {r.editor && <span>· {r.editor}</span>}
                      {i === 0 && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-emerald-400">current</span>}
                    </div>
                    <div className="text-sm comment-md"><Markdown>{r.body || '*(empty)*'}</Markdown></div>
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={History} title="No history" sub="This comment hasn't been edited." />}
        </Modal>
      )}

      {/* Concurrent-edit resolver: shown when the server reports someone else changed the
          comment since we started editing — same GitHub-style 3-way merge as posts/docs. */}
      {conflict && (
        <DiffMergeModal open onClose={() => setConflict(null)}
          base={conflict.base} mine={conflict.mine} theirs={conflict.theirs}
          labels={{ mine: 'Your edit', theirs: 'Their edit' }} onResolve={resolveConflict} />
      )}
    </Modal>
  );
}
