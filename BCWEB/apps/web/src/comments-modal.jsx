import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useToast, Button, Spinner, Modal, EmptyState, Input, Textarea, Select } from './ui.jsx';
import UserAvatar from './Avatar.jsx';
import Markdown from './md.jsx';
import { MarkdownEditor } from './blog.jsx';
import { MessageSquare, CornerDownRight, Check, Pencil, Trash2, Send, Tag, Globe, Lock, Hash } from 'lucide-react';

// Heading anchor slug — must match the docs/blog renderer (md.jsx) so a comment pinned
// to a section can scroll to it.
const headingSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
// Pull the ## / ### headings out of a markdown body → pickable section list.
const extractSections = (md) => [...new Set((String(md || '').match(/^#{2,3}\s+.+$/gm) || [])
  .map((h) => h.replace(/^#{2,3}\s+/, '').replace(/[*_`]/g, '').trim()).filter(Boolean))].slice(0, 60);

// Threaded editor-collaboration comments for a blog post (PR-review style). Any editor
// can read, add, reply, resolve, and EDIT any comment. `base` = `/blog/<id>`. `body` (the
// post/page markdown) powers the "pin to a section" picker + click-to-jump. `onJump(slug)`
// (optional) lets the reader scroll to a section when a pin is clicked.
export default function CommentsModal({ base, onClose, readOnly, body, onJump }) {
  const toast = useToast();
  const [data, setData] = useState(null); // { comments, canComment, commentsPublic }
  const [draft, setDraft] = useState({ body: '', anchor: '' });
  const [customAnchor, setCustomAnchor] = useState(false); // "Custom…" chosen in the picker
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [editing, setEditing] = useState(null); // { id, body }
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => extractSections(body), [body]);

  const load = () => api.get(`${base}/comments`).then(setData).catch(() => setData({ comments: [], canComment: false }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [base]);

  const canWrite = !readOnly && data?.canComment;
  const roots = (data?.comments || []).filter((c) => !c.parentId);
  const repliesOf = (id) => (data?.comments || []).filter((c) => c.parentId === id);

  const add = async () => {
    if (!draft.body.trim()) return;
    setBusy(true);
    try { await api.post(`${base}/comments`, { body: draft.body.trim(), anchor: draft.anchor.trim() || null }); setDraft({ body: '', anchor: '' }); await load(); }
    catch { toast.error('Could not post the comment.'); } finally { setBusy(false); }
  };
  const reply = async (parentId) => {
    if (!replyBody.trim()) return;
    setBusy(true);
    try { await api.post(`${base}/comments`, { body: replyBody.trim(), parentId }); setReplyTo(null); setReplyBody(''); await load(); }
    catch { toast.error('Could not reply.'); } finally { setBusy(false); }
  };
  const saveEdit = async () => {
    setBusy(true);
    try { await api.patch(`${base}/comments/${editing.id}`, { body: editing.body }); setEditing(null); await load(); }
    catch { toast.error('Could not save.'); } finally { setBusy(false); }
  };
  const toggleResolved = async (c) => { try { await api.patch(`${base}/comments/${c.id}`, { resolved: !c.resolved }); await load(); } catch { toast.error('Failed.'); } };
  const del = async (id) => { try { await api.del(`${base}/comments/${id}`); await load(); } catch { toast.error('Failed.'); } };

  const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  // Real avatar: author.avatar is the saved descriptor { variant, seed, colors, image },
  // not a URL — feed it to the shared Avatar component (was <img src={object}> → broke,
  // showing only the letter fallback).
  const Avatar = ({ a }) => <UserAvatar user={{ id: a?.author?.id, displayName: a?.author?.name, avatar: a?.author?.avatar }} size={24} className="shrink-0" />;

  const CommentBody = ({ c, isReply }) => (
    <div className={`${c.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Avatar a={c} />
        <span className="text-sm font-medium">{c.author?.name}</span>
        <span className="text-[11px] text-[var(--faint)]">{fmt(c.createdAt)}{(c.edited || c.updatedAt !== c.createdAt) ? ' · edited' : ''}</span>
        {c.resolved && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 flex items-center gap-0.5"><Check size={10} /> resolved</span>}
        {/* Everyone who participated (author + editors) — their pfps, git-style. */}
        {c.participants?.length > 1 && (
          <span className="flex items-center -space-x-1.5 ml-auto" title={`Contributors: ${c.participants.map((u) => u.name).join(', ')}`}>
            {c.participants.slice(0, 5).map((u) => (
              <UserAvatar key={u.id} user={{ id: u.id, displayName: u.name, avatar: u.avatar }} size={18} className="ring-1 ring-[var(--surface)] rounded-full" />
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
          <button className="hover:text-[var(--text)] flex items-center gap-1" onClick={() => setEditing({ id: c.id, body: c.body })}><Pencil size={11} /> Edit</button>
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

  return (
    <Modal open onClose={onClose} title="Comments" icon={MessageSquare} width="max-w-2xl"
      footer={<>
        <span className="text-xs mr-auto flex items-center gap-1.5 text-[var(--faint)]">
          {data?.commentsPublic ? <><Globe size={13} className="text-emerald-400" /> Visible to readers</> : <><Lock size={13} /> Editors only</>}
        </span>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {data === null ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {roots.length === 0 && <EmptyState icon={MessageSquare} title="No comments yet" sub={canWrite ? 'Start the discussion below.' : 'Nothing here yet.'} />}
          {roots.map((c) => (
            <div key={c.id} className="rounded-xl border border-[var(--line)] p-3">
              <CommentBody c={c} />
              {repliesOf(c.id).length > 0 && (
                <div className="ml-4 mt-3 pl-3 border-l-2 border-[var(--line)] space-y-3">
                  {repliesOf(c.id).map((r) => <CommentBody key={r.id} c={r} isReply />)}
                </div>
              )}
            </div>
          ))}
        </div>
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
    </Modal>
  );
}
