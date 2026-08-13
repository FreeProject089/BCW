-- Does an announced price change touch people who are already subscribed?
--
-- Default false, which is also what happens today with or without this column: every
-- Stripe subscription is pinned to an ad-hoc Price created at its own checkout, so
-- changing a plan's price only ever reaches new buyers. Existing subscribers are
-- grandfathered by the payment model, not by anyone's decision.
--
-- True moves their subscription item onto a new Price on the effective date, with
-- proration_behavior 'none' so the new amount starts at the next renewal and nobody is
-- billed mid-term.

-- AlterTable
ALTER TABLE "HostingPlan" ADD COLUMN "pendingApplyExisting" BOOLEAN NOT NULL DEFAULT false;
