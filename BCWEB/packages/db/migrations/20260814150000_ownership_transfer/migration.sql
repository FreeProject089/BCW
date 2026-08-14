-- Handing a repository or a catalog item to somebody else.
--
-- A request, never an act. The recipient inherits storage they will be billed for, content
-- they become answerable for, and any abuse reports attached to the object — pushing that
-- onto an account without asking makes somebody the owner of a problem they have never
-- seen.
--
-- No foreign keys to ServerRepo/CatalogItem on purpose: `kind` + `targetId` is polymorphic,
-- and the row must outlive the object so it can still answer "who used to own this".
-- targetName is snapshotted for the same reason.

-- CreateTable
CREATE TABLE "OwnershipTransfer" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnershipTransfer_toUserId_status_idx" ON "OwnershipTransfer"("toUserId", "status");
CREATE INDEX "OwnershipTransfer_fromUserId_status_idx" ON "OwnershipTransfer"("fromUserId", "status");
CREATE INDEX "OwnershipTransfer_kind_targetId_status_idx" ON "OwnershipTransfer"("kind", "targetId", "status");
