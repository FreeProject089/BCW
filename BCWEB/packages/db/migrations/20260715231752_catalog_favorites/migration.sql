-- CreateTable
CREATE TABLE "CatalogFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogFavorite_catalogId_idx" ON "CatalogFavorite"("catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogFavorite_userId_catalogId_key" ON "CatalogFavorite"("userId", "catalogId");

-- AddForeignKey
ALTER TABLE "CatalogFavorite" ADD CONSTRAINT "CatalogFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogFavorite" ADD CONSTRAINT "CatalogFavorite_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "CommunityCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
