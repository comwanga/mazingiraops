-- A client-generated submission key makes draft creation idempotent without
-- preventing legitimate additional work logs for the same ward and date.
ALTER TABLE "WorkLog" ADD COLUMN "clientSubmissionId" TEXT;

CREATE UNIQUE INDEX "WorkLog_clientSubmissionId_key" ON "WorkLog"("clientSubmissionId");
