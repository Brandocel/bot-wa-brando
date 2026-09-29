-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('DRIVE', 'PC');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'DRIVE',
ALTER COLUMN "driveFolderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConnectorDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectorDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorPairCode" (
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorPairCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorDevice_tokenHash_key" ON "ConnectorDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "ConnectorDevice_organizationId_idx" ON "ConnectorDevice"("organizationId");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_idx" ON "StoredFile"("organizationId");

-- AddForeignKey
ALTER TABLE "ConnectorDevice" ADD CONSTRAINT "ConnectorDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorPairCode" ADD CONSTRAINT "ConnectorPairCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

