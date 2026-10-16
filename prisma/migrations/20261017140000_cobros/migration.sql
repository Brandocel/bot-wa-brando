CREATE TABLE "Cobro" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "iva" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "pagadoAt" TIMESTAMP(3) NOT NULL,
    "reciboUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cobro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cobro_stripeInvoiceId_key" ON "Cobro"("stripeInvoiceId");

CREATE INDEX "Cobro_pagadoAt_idx" ON "Cobro"("pagadoAt");

ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Suscripcion"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
