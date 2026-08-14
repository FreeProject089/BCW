-- Outgoing webhooks: an address to tell when something happens, so integrations stop polling.
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL DEFAULT '',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "disabledReason" TEXT,
    "lastAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookEndpoint_userId_idx" ON "WebhookEndpoint"("userId");
CREATE INDEX "WebhookEndpoint_enabled_idx" ON "WebhookEndpoint"("enabled");
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "httpStatus" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
CREATE INDEX "WebhookDelivery_status_nextAt_idx" ON "WebhookDelivery"("status", "nextAt");
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
