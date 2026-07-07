import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useToast, Button, Spinner, Modal, EmptyState, Input, Textarea } from './ui.jsx';
import { MessageSquare, CornerDownRight, Check, Pencil, Trash2, Send, Tag, Globe, Lock } from 'lucide-react';

// Threaded editor-collaboration comments for a blog post (PR-review style). Any editor
// can read, add, reply, resolve, and EDIT any comment. `base` = `/blog/<id>`. `readOnly`
// renders the reader view (visible when the post is commentsPublic) without write UI.
export default function CommentsModal({ base, onClose, readOnly }) {
  const toast = useToast();
  const [data, setData] = useState(null); // { comments, canComment, commentsPublic }
  const [draft, setDraft] = useState({ body: '', anchor: '' });
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [editing, setEditing] = useState(null); // { id, body }
  const [busy, setBusy] = useState(false);

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
  const Avatar = ({ a }) => a?.author?.avatar
    ? <img src={a.author.avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
    : <span className="w-6 h-6 rounded-full bg-[var(--surface-2)] grid place-items-center text-[10px] font-bold shrink-0">{(a?.author?.name || '?').slice(0, 1).toUpperCase()}</span>;

  const CommentBody = ({ c, isReply }) => (
    <div className={`${c.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <Avatar a={c} />
        <span className="text-sm font-medium">{c.author?.name}</span>
        <span className="text-[11px] text-[var(--faint)]">{fmt(c.createdAt)}{c.updatedAt !== c.createdAt ? ' · edited' : ''}</span>
        {c.resolved && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 flex items-center gap-0.5"><Check size={10} /> resolved</span>}
      </div>
      {c.anchor && !isReply && <div className="ml-8 mt-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary-2)]"><Tag size={10} /> {c.anchor}</div>}
      {editing?.id === c.id ? (
        <div className="ml-8 mt-1.5">
          <Textarea rows={2} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          <div className="flex gap-1.5 mt-1.5"><Button size="sm" variant="primary" disabled={busy} onClick={saveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="ml-8 mt-1 text-sm whitespace-pre-wrap break-words">{c.body}</div>
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
          <div className="flex items-center gap-2 mb-1.5">
            <Tag size={13} className="text-[var(--faint)]" />
            <Input value={draft.anchor} onChange={(e) => setDraft({ ...draft, anchor: e.target.value })} placeholder="Pin to a section/line (optional, e.g. “Intro”)" className="!py-1.5 !text-sm" />
          </div>
          <Textarea rows={2} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Leave a comment for other editors…" />
          <div className="flex justify-end mt-1.5"><Button size="sm" variant="primary" disabled={busy || !draft.body.trim()} onClick={add}><Send size={14} /> Comment</Button></div>
        </div>
      )}
    </Modal>
  );
}
