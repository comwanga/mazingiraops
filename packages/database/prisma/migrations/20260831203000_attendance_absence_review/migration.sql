CREATE TYPE "AttendanceAbsenceReason" AS ENUM ('SICK_OFF', 'WEEKEND_OFF_DUTY');
CREATE TYPE "AttendanceReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Attendance"
ADD COLUMN "absenceReason" "AttendanceAbsenceReason",
ADD COLUMN "absenceReviewStatus" "AttendanceReviewStatus",
ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reviewedBy" TEXT,
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Attendance_wardId_workDate_absenceReviewStatus_idx"
ON "Attendance"("wardId", "workDate", "absenceReviewStatus");
