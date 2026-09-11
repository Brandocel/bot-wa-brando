-- CreateTable
CREATE TABLE "SupportAgent" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportAgent_waId_key" ON "SupportAgent"("waId");

-- CreateIndex
CREATE INDEX "SupportAgent_active_idx" ON "SupportAgent"("active");

-- CreateIndex
CREATE INDEX "Ticket_assignedToWaId_state_idx" ON "Ticket"("assignedToWaId", "state");

-- Los tickets asignados a mano a un número que no está en la tabla no
-- pueden llevar la llave foránea: se desasignan antes de crearla.
UPDATE "Ticket" SET "assignedToWaId" = NULL
WHERE "assignedToWaId" IS NOT NULL
  AND "assignedToWaId" NOT IN (SELECT "waId" FROM "SupportAgent");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToWaId_fkey" FOREIGN KEY ("assignedToWaId") REFERENCES "SupportAgent"("waId") ON DELETE SET NULL ON UPDATE CASCADE;
