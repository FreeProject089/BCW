-- The two most expensive hosting plans come with included boosts.
--
-- A boost is the existing "featured" credit: a BoostCredit row the sweeper grants
-- (grantIncludedBoosts) and the owner spends on a repo or a catalogue. The columns for it
-- already existed on HostingPlan and defaulted to zero, so every install shipped the feature
-- switched off and the public plan card said "Boosts bought separately" on every tier.
--
-- Data only, and deliberately conservative: it runs ONLY when no plan carries boosts yet, so
-- an admin who already configured them (or who chose zero on purpose) is never overwritten.
-- Re-running it after that guard has been satisfied is a no-op, because by then the EXISTS
-- clause is false.
UPDATE "HostingPlan" p
SET "boostsPerPeriod" = CASE WHEN r.rank = 1 THEN 3 ELSE 1 END,
    "boostPeriodMonths" = 1,
    "boostDays" = 7
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "priceMonthlyCents" DESC, "storageGB" DESC, "id") AS rank
  FROM "HostingPlan"
  WHERE "active" = true AND "priceMonthlyCents" > 0
) r
WHERE p."id" = r."id"
  AND r.rank <= 2
  AND NOT EXISTS (SELECT 1 FROM "HostingPlan" WHERE "boostsPerPeriod" > 0);
