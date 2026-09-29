-- CreateEnum
CREATE TYPE "DocClass" AS ENUM ('ENTREGABLE', 'INTERNO', 'SENSIBLE', 'DUDOSO');

-- AlterEnum


ALTER TYPE "DocCategory" ADD VALUE 'ESTADO_CUENTA';
ALTER TYPE "DocCategory" ADD VALUE 'CONTABLE';

-- AlterEnum
ALTER TYPE "DocStatus" ADD VALUE 'EXCLUDED';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "classification" JSONB,
ADD COLUMN     "classifiedBy" TEXT,
ADD COLUMN     "classifiedVersion" TEXT,
ADD COLUMN     "counterpart" TEXT,
ADD COLUMN     "docClass" "DocClass",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "summary" TEXT;

-- CreateIndex
CREATE INDEX "Document_classifiedVersion_idx" ON "Document"("classifiedVersion");

