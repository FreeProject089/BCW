-- One moderation decision, with a reference the e-mail can quote and the user can contest.
CREATE TABLE "Sanction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'account',
    "userId" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "relatedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "request" TEXT,
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,
    "liftReason" TEXT,
    "contestedAt" TIMESTAMP(3),
    "contestBody" TEXT,
    "contestOutcome" TEXT,
    "contestAnswer" TEXT,
    "contestAnsweredAt" TIMESTAMP(3),
    "contestAnsweredById" TEXT,
    "meta" JSONB,

    CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sanction_code_key" ON "Sanction"("code");
CREATE INDEX "Sanction_userId_issuedAt_idx" ON "Sanction"("userId", "issuedAt");
CREATE INDEX "Sanction_status_expiresAt_idx" ON "Sanction"("status", "expiresAt");
CREATE INDEX "Sanction_targetType_targetId_idx" ON "Sanction"("targetType", "targetId");

ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
