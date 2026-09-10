-- CreateEnum
CREATE TYPE "PanelRole" AS ENUM ('ADMIN', 'AGENTE');

-- CreateTable
CREATE TABLE "PanelUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PanelRole" NOT NULL DEFAULT 'AGENTE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanelUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanelSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PanelUser_email_key" ON "PanelUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PanelSession_tokenHash_key" ON "PanelSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PanelSession_expiresAt_idx" ON "PanelSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "PanelSession" ADD CONSTRAINT "PanelSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PanelUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

