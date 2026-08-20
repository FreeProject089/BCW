-- CreateTable
CREATE TABLE "SessionReplay" (
    "id" TEXT NOT NULL,
    "visitor" TEXT,
    "path" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "device" TEXT,
    "browser" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionReplay_createdAt_idx" ON "SessionReplay"("createdAt");
