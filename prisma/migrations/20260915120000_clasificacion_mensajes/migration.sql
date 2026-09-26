-- CreateEnum
CREATE TYPE "MessageIntent" AS ENUM ('SOLICITUD', 'QUEJA', 'CONSULTA', 'SEGUIMIENTO', 'PIDE_HUMANO', 'CORTESIA', 'OTRO');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "intent" "MessageIntent",
ADD COLUMN     "motivo" TEXT,
ADD COLUMN     "molesto" BOOLEAN NOT NULL DEFAULT false;
