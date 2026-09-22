-- The sent-mail log (MailLog). No body column, by design: see the model comment in
-- schema.prisma. Hand-applied from `prisma migrate diff --from-schema-datasource`.
-- CreateTable
CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "userId" TEXT,
    "mailId" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attachments" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailLog_createdAt_idx" ON "MailLog"("createdAt");

-- CreateIndex
CREATE INDEX "MailLog_status_createdAt_idx" ON "MailLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MailLog_mailId_createdAt_idx" ON "MailLog"("mailId", "createdAt");

-- CreateIndex
CREATE INDEX "MailLog_userId_idx" ON "MailLog"("userId");

-- AddForeignKey
ALTER TABLE "MailLog" ADD CONSTRAINT "MailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

