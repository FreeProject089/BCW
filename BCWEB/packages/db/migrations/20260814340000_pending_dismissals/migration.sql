-- Rows cleared out of the "Needs attention" list. Hides the row there and nowhere else:
-- the queue counts stay truthful because the work still exists.
CREATE TABLE "PendingDismissal" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'handled',
    "byId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingDismissal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PendingDismissal_queue_itemId_key" ON "PendingDismissal"("queue", "itemId");
CREATE INDEX "PendingDismissal_at_idx" ON "PendingDismissal"("at");
ALTER TABLE "PendingDismissal" ADD CONSTRAINT "PendingDismissal_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
