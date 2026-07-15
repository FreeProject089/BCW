-- CreateIndex
CREATE INDEX "CatalogItem_status_updatedAt_idx" ON "CatalogItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CatalogItem_status_downloads_idx" ON "CatalogItem"("status", "downloads");

-- CreateIndex
CREATE INDEX "CatalogItem_status_views_idx" ON "CatalogItem"("status", "views");

-- CreateIndex
CREATE INDEX "CatalogItem_projectId_kind_status_idx" ON "CatalogItem"("projectId", "kind", "status");
