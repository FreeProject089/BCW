-- CreateIndex
CREATE INDEX "ServerRepo_listed_verified_pendingReview_createdAt_idx" ON "ServerRepo"("listed", "verified", "pendingReview", "createdAt");
