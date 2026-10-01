-- agent-bcw-pools: a pool dedicated to one project, and admin-made payment links.

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "HostingGroup" ADD COLUMN "projectTarget" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HostingGroup_projectTarget_key" ON "HostingGroup"("projectTarget");

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "provision" JSONB NOT NULL DEFAULT '{}',
    "priceMode" TEXT NOT NULL DEFAULT 'custom',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "interval" TEXT NOT NULL DEFAULT 'once',
    "maxUses" INTEGER,
    "onlyEmail" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLinkUse" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "result" JSONB NOT NULL DEFAULT '{}',
    "stripeSubId" TEXT,
    "holdUntil" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_token_key" ON "PaymentLink"("token");
CREATE INDEX "PaymentLink_createdAt_idx" ON "PaymentLink"("createdAt");
CREATE UNIQUE INDEX "PaymentLinkUse_sessionId_key" ON "PaymentLinkUse"("sessionId");
CREATE INDEX "PaymentLinkUse_linkId_status_idx" ON "PaymentLinkUse"("linkId", "status");
CREATE INDEX "PaymentLinkUse_userId_idx" ON "PaymentLinkUse"("userId");

-- AddForeignKey
ALTER TABLE "PaymentLinkUse" ADD CONSTRAINT "PaymentLinkUse_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
