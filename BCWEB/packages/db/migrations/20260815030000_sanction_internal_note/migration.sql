-- Staff-only note on a sanction.
--
-- `reason` is quoted to the person in the e-mail and comes back in any contest, so it can
-- never hold "third account from this IP, see SNC-4821". That context previously went into
-- reason (disclosed) or nowhere (lost). Nullable: every existing row keeps meaning what it
-- meant, and no backfill can invent a note nobody wrote.
ALTER TABLE "Sanction" ADD COLUMN "internalNote" TEXT;
