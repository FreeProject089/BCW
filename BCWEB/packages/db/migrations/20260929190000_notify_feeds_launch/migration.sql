-- notify (agent-notify): the notification engine (NotificationSend + fan-out columns on
-- Notification), project follows, the personal RSS token, and the BMM launch feed.
-- Additive, plus Notification.userId now cascades on a hard account delete (a notification is
-- its recipient's). New tables, nullable/defaulted columns, new indexes: safe for a rolling deploy.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sendId" TEXT;

-- CreateTable
CREATE TABLE "NotificationSend" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "bodyFr" TEXT,
    "href" TEXT,
    "audience" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "public" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targeted" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "muted" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "FeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BmmLaunchItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "postId" TEXT,
    "projectKey" TEXT NOT NULL DEFAULT 'bmm',
    "title" TEXT NOT NULL DEFAULT '',
    "titleFr" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryFr" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "displayMode" TEXT NOT NULL DEFAULT 'once',
    "times" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minVersion" TEXT,
    "maxVersion" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BmmLaunchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSend_dedupeKey_key" ON "NotificationSend"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationSend_public_createdAt_idx" ON "NotificationSend"("public", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationSend_contentHash_createdAt_idx" ON "NotificationSend"("contentHash", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationSend_createdAt_idx" ON "NotificationSend"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectFollow_target_idx" ON "ProjectFollow"("target");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFollow_userId_target_key" ON "ProjectFollow"("userId", "target");

-- CreateIndex
CREATE UNIQUE INDEX "FeedToken_userId_key" ON "FeedToken"("userId");

-- CreateIndex
CREATE INDEX "BmmLaunchItem_enabled_idx" ON "BmmLaunchItem"("enabled");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_sendId_userId_key" ON "Notification"("sendId", "userId");

-- DropForeignKey / AddForeignKey: the recipient key cascades.
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "NotificationSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFollow" ADD CONSTRAINT "ProjectFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedToken" ADD CONSTRAINT "FeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

