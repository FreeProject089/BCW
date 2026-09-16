-- The invitation link's foreign key, missed when the table was written by hand while the
-- database was unreachable: the schema declares `team Team @relation(onDelete: Cascade)`, so
-- without this a deleted team would leave its links behind, pointing at nothing, and
-- `migrate diff` reported the drift the moment the database came back.
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
