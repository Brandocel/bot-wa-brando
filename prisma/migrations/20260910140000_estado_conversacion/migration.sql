-- CreateEnum
CREATE TYPE "Awaiting" AS ENUM ('NADIE', 'BOT', 'CLIENTE', 'AGENTE');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "awaiting" "Awaiting" NOT NULL DEFAULT 'NADIE',
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "seenAt" TIMESTAMP(3),
ADD COLUMN     "topic" "DocCategory";

-- CreateIndex
CREATE INDEX "Conversation_awaiting_lastInboundAt_idx" ON "Conversation"("awaiting", "lastInboundAt");

