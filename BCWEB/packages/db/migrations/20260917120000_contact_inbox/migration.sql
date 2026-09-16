-- The contact inbox: what staff DID with a contact message, and whether a member accepts
-- conversations. Three new tables, nothing altered — ContactMessage keeps every column it
-- had, and the widened `status` vocabulary (new | open | waiting | resolved | spam) needs no
-- DDL because that column was already a free-text String defaulting to 'new'.

-- CreateTable
CREATE TABLE "ContactTicket" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "firstReplyAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactReply" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'reply',
    "body" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMessagingPref" (
    "userId" TEXT NOT NULL,
    "acceptsDirect" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMessagingPref_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactTicket_messageId_key" ON "ContactTicket"("messageId");

-- CreateIndex
CREATE INDEX "ContactTicket_assigneeId_idx" ON "ContactTicket"("assigneeId");

-- CreateIndex
CREATE INDEX "ContactTicket_priority_idx" ON "ContactTicket"("priority");

-- CreateIndex
CREATE INDEX "ContactReply_messageId_createdAt_idx" ON "ContactReply"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "UserMessagingPref_acceptsDirect_idx" ON "UserMessagingPref"("acceptsDirect");
