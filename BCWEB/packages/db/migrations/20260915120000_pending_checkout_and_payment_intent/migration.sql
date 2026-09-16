-- AlterTable
ALTER TABLE "ProjectProductPurchase" ADD COLUMN     "paymentIntentId" TEXT;

-- CreateTable
CREATE TABLE "PendingCheckout" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingCheckout_sessionId_key" ON "PendingCheckout"("sessionId");

-- CreateIndex
CREATE INDEX "PendingCheckout_status_createdAt_idx" ON "PendingCheckout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingCheckout_kind_idx" ON "PendingCheckout"("kind");
