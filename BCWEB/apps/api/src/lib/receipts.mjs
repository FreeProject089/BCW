// Read receipts for every conversation on the site: sent, delivered, read.
//
// The rule is WhatsApp's, and it is written once, here, for the three conversation tables
// (contact threads, reports, MYO requests), because a rule written three times diverges.
//
//   sent       the server has it. Every message is at least this.
//   delivered  the recipient's side has LISTED it: their inbox or their dashboard fetched
//              the conversation, or, for an anonymous sender, the mail telling them about it
//              went out. They could have seen it; nothing says they did.
//   read       the recipient's side OPENED the conversation after it was written.
//
// State is kept per conversation SIDE (ConversationCursor), not per message: one row holds
// the last time each side was delivered to and the last time it read. A message's receipt is
// derived from the OTHER side's cursor and its own createdAt, so reading the newest message
// reads every older one too, exactly like the double blue tick. Two writes per visit.
//
// A side is a group when the far end is: a team's inbox, the staff queue. "Read" then means
// somebody on that side opened it, which is the fact the writer needs.
//
// Receipts are only attached to the VIEWER's own messages. What the other person's ticks
// look like is not the viewer's business, and a receipt on a message you did not write is
// information about yourself that you already have.

/** The two sides of each kind, and who a message from one side is addressed to. */
export const SIDES = {
  thread: ['sender', 'owner'],
  report: ['reporter', 'staff'],
  myo: ['user', 'staff'],
};

/** The side that RECEIVES a message written by `from` in a conversation of `kind`. */
export function recipientSide(kind, from) {
  if (kind === 'thread') return from === 'sender' ? 'owner' : 'sender'; // owner and staff write to the sender
  if (kind === 'report') return from === 'staff' ? 'reporter' : 'staff';
  if (kind === 'myo') return from === 'staff' ? 'user' : 'staff';
  return null;
}

/**
 * The state of one message, from its recipient side's cursor. Pure; exported for the tests.
 * A cursor timestamp EQUAL to createdAt counts: a read in the same millisecond is a read.
 */
export function receiptOf(createdAt, cursor) {
  const at = new Date(createdAt).getTime();
  if (cursor?.readAt && new Date(cursor.readAt).getTime() >= at) return 'read';
  if (cursor?.deliveredAt && new Date(cursor.deliveredAt).getTime() >= at) return 'delivered';
  return 'sent';
}

const valid = (kind, side) => !!SIDES[kind]?.includes(side);

/** The recipient side opened the conversation: delivered AND read, now. */
export async function markRead(p, kind, conversationId, side, at = new Date()) {
  if (!valid(kind, side) || !conversationId) return;
  await p.conversationCursor.upsert({
    where: { kind_conversationId_side: { kind, conversationId, side } },
    create: { kind, conversationId, side, deliveredAt: at, readAt: at },
    // Reading also cancels a pending "you have unread messages" mail: there is nothing
    // unread left to tell them about.
    update: { deliveredAt: at, readAt: at, mailDueAt: null },
  }).catch(() => {});
}

/**
 * The recipient side LISTED these conversations: delivered, now. Two statements for any
 * number of conversations (create the missing rows, then move every one forward), so an
 * inbox of two hundred threads is not two hundred upserts.
 */
export async function markDelivered(p, kind, ids, side, at = new Date()) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!valid(kind, side) || !list.length) return;
  await p.conversationCursor.createMany({ data: list.map((conversationId) => ({ kind, conversationId, side })), skipDuplicates: true }).catch(() => {});
  await p.conversationCursor.updateMany({ where: { kind, side, conversationId: { in: list } }, data: { deliveredAt: at } }).catch(() => {});
}

/** Every cursor of one conversation, by side. */
export async function cursorsOf(p, kind, conversationId) {
  const rows = await p.conversationCursor.findMany({ where: { kind, conversationId } }).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.side, r]));
}

/**
 * Attach `receipt` to the messages the viewer wrote. `sideOf(message)` names the side a
 * message was written from; `isMine(message)` says whether the viewer wrote it. A message
 * from nobody (a system note) never carries a receipt.
 */
export function withReceipts(kind, messages, cursors, { sideOf, isMine }) {
  return (messages || []).map((m) => {
    if (!isMine(m)) return m;
    const to = recipientSide(kind, sideOf(m));
    return { ...m, receipt: receiptOf(m.createdAt, cursors?.[to]) };
  });
}
