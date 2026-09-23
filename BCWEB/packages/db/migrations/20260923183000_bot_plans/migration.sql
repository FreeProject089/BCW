-- M21 Discord bot plans: a plan can be a bot-only plan (kind 'bot') and any plan can carry
-- bot entitlements (bot JSON); a subscription names the Discord servers they apply to.
-- Additive only: every existing plan stays kind 'hosting' with no bot entitlements ({}).
-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'BOT_PLAN';

-- AlterTable
ALTER TABLE "HostingPlan" ADD COLUMN     "bot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'hosting';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "botGuildIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

