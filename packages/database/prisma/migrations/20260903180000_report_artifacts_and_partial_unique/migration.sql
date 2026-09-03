-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('PDF');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ReportArtifact" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL DEFAULT 'PDF',
    "status" "ArtifactStatus" NOT NULL DEFAULT 'GENERATING',
    "objectKey" TEXT,
    "sha256" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
    "size" INTEGER,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "rendererVersion" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportArtifact_objectKey_key" ON "ReportArtifact"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportArtifact_reportId_kind_key" ON "ReportArtifact"("reportId", "kind");

-- CreateIndex
CREATE INDEX "ReportArtifact_reportId_idx" ON "ReportArtifact"("reportId");

-- AddForeignKey
ALTER TABLE "ReportArtifact" ADD CONSTRAINT "ReportArtifact_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index to strictly protect against duplicate finalized reports while allowing drafts/rollups
CREATE UNIQUE INDEX "Report_finalized_identity_idx" ON "Report" ("scopeType", "scopeId", "kind", "periodStart", "periodEnd") WHERE "status" = 'FINALIZED';
