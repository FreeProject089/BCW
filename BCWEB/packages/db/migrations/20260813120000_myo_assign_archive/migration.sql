-- Ownership and archiving for commission requests.
--
-- assignedToId: a queue where everybody sees everything is a queue where two people answer
-- the same request and nobody answers the next one. ON DELETE SET NULL — a staff account
-- being removed must unassign their work, never delete the request: there is money
-- attached to these rows.
--
-- archivedAt: handled and out of the working queue, still on file. Deliberately separate
-- from `closed`, because a closed request can still need invoicing and a cancelled one is
-- still history.

-- AlterTable
ALTER TABLE "MyoRequest" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "MyoRequest" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "MyoRequest" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MyoRequest_assignedToId_idx" ON "MyoRequest"("assignedToId");
CREATE INDEX "MyoRequest_archivedAt_idx" ON "MyoRequest"("archivedAt");

-- AddForeignKey
ALTER TABLE "MyoRequest" ADD CONSTRAINT "MyoRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
