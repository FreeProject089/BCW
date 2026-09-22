-- CreateTable
CREATE TABLE "ConversationCursor" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "mailDueAt" TIMESTAMP(3),
    "mailedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationCursor_mailDueAt_idx" ON "ConversationCursor"("mailDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationCursor_kind_conversationId_side_key" ON "ConversationCursor"("kind", "conversationId", "side");

