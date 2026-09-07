-- CreateTable
CREATE TABLE "ProjectProduct" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT,
    "showcaseProjectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deliveryKind" TEXT NOT NULL DEFAULT 'content',
    "staticKey" TEXT,
    "content" TEXT,
    "roleId" TEXT,
    "externalUrl" TEXT,
    "externalSecret" TEXT,
    "stock" INTEGER,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectKey" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProductPurchase" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "delivery" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProductPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectProduct_projectKey_active_idx" ON "ProjectProduct"("projectKey", "active");

-- CreateIndex
CREATE INDEX "ProjectProduct_showcaseProjectId_active_idx" ON "ProjectProduct"("showcaseProjectId", "active");

-- CreateIndex
CREATE INDEX "ProjectKey_productId_claimedAt_idx" ON "ProjectKey"("productId", "claimedAt");

-- CreateIndex
CREATE INDEX "ProjectProductPurchase_buyerId_createdAt_idx" ON "ProjectProductPurchase"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectProductPurchase_productId_createdAt_idx" ON "ProjectProductPurchase"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectKey" ADD CONSTRAINT "ProjectKey_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProjectProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProductPurchase" ADD CONSTRAINT "ProjectProductPurchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProjectProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProductPurchase" ADD CONSTRAINT "ProjectProductPurchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

