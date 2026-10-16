CREATE TABLE "Suscripcion" (
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeScheduleId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "conFactura" BOOLEAN NOT NULL DEFAULT false,
    "mesesPagados" INTEGER NOT NULL DEFAULT 0,
    "ultimoCobroId" TEXT,
    "ultimoCobroAt" TIMESTAMP(3),
    "checkoutUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suscripcion_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX "Suscripcion_stripeSubscriptionId_key" ON "Suscripcion"("stripeSubscriptionId");

ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
