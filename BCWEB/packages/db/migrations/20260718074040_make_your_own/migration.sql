-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentKind" ADD VALUE 'MYO_CONSULTATION';
ALTER TYPE "PaymentKind" ADD VALUE 'MYO_PRODUCT';

-- CreateTable
CREATE TABLE "MyoProduct" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "basePriceCents" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '[]',
    "includesSource" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyoProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyoRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "productKind" TEXT NOT NULL DEFAULT 'custom',
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "objective" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT 'personal',
    "description" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT 'en',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "consultationPaid" BOOLEAN NOT NULL DEFAULT false,
    "consultationCents" INTEGER NOT NULL DEFAULT 0,
    "stripeSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "staffUnread" BOOLEAN NOT NULL DEFAULT true,
    "userUnread" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyoMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT,
    "staff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL DEFAULT '',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MyoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyoQuote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "includesSource" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'sent',
    "stripeSessionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "MyoQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyoDeliverable" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "fileUrl" TEXT,
    "fileName" TEXT,
    "linkUrl" TEXT,
    "includesSource" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MyoDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MyoProduct_active_order_idx" ON "MyoProduct"("active", "order");

-- CreateIndex
CREATE INDEX "MyoRequest_userId_idx" ON "MyoRequest"("userId");

-- CreateIndex
CREATE INDEX "MyoRequest_status_idx" ON "MyoRequest"("status");

-- CreateIndex
CREATE INDEX "MyoRequest_lastActivityAt_idx" ON "MyoRequest"("lastActivityAt");

-- CreateIndex
CREATE INDEX "MyoMessage_requestId_idx" ON "MyoMessage"("requestId");

-- CreateIndex
CREATE INDEX "MyoQuote_requestId_idx" ON "MyoQuote"("requestId");

-- CreateIndex
CREATE INDEX "MyoDeliverable_requestId_idx" ON "MyoDeliverable"("requestId");

-- AddForeignKey
ALTER TABLE "MyoRequest" ADD CONSTRAINT "MyoRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyoRequest" ADD CONSTRAINT "MyoRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MyoProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyoMessage" ADD CONSTRAINT "MyoMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MyoRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyoMessage" ADD CONSTRAINT "MyoMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyoQuote" ADD CONSTRAINT "MyoQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MyoRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyoDeliverable" ADD CONSTRAINT "MyoDeliverable_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MyoRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

