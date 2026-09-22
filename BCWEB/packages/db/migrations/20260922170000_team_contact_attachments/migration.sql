-- CreateTable
CREATE TABLE "ContactThreadAttachment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactThreadAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamContactSettings" (
    "teamId" TEXT NOT NULL,
    "answerRoles" TEXT[] DEFAULT ARRAY['owner', 'admin', 'member']::TEXT[],
    "maxOpenMembers" INTEGER NOT NULL DEFAULT 0,
    "maxOpenAnon" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamContactSettings_pkey" PRIMARY KEY ("teamId")
);

-- CreateIndex
CREATE INDEX "ContactThreadAttachment_threadId_idx" ON "ContactThreadAttachment"("threadId");

-- CreateIndex
CREATE INDEX "ContactThreadAttachment_messageId_idx" ON "ContactThreadAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "ContactThreadAttachment" ADD CONSTRAINT "ContactThreadAttachment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ContactThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

