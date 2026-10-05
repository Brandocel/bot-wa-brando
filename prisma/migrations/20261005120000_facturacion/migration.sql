-- Facturación CFDI 4.0 por empresa (Factura.com): configuración con llaves
-- cifradas, perfiles fiscales de clientes, facturas y la plática de "quiero
-- factura" en curso. Claves del SAT por producto.
-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('POR_APROBAR', 'TIMBRANDO', 'TIMBRADA', 'ERROR', 'RECHAZADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "satProdCode" TEXT,
ADD COLUMN     "satUnitCode" TEXT;

-- CreateTable
CREATE TABLE "InvoicingSettings" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyEnc" TEXT,
    "secretKeyEnc" TEXT,
    "serieId" INTEGER,
    "lugarExpedicion" TEXT NOT NULL DEFAULT '',
    "fallbackEmail" TEXT NOT NULL DEFAULT '',
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
    "ivaBasisPoints" INTEGER NOT NULL DEFAULT 1600,
    "defaultProdCode" TEXT NOT NULL DEFAULT '01010101',
    "defaultUnitCode" TEXT NOT NULL DEFAULT 'H87',
    "deliveryProdCode" TEXT NOT NULL DEFAULT '78102203',
    "maxDaysAfterSale" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoicingSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "regimen" TEXT NOT NULL,
    "usoCfdi" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "orderId" TEXT,
    "fiscalProfileId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'POR_APROBAR',
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "receptor" JSONB NOT NULL,
    "concepts" JSONB NOT NULL,
    "formaPago" TEXT NOT NULL,
    "metodoPago" TEXT NOT NULL DEFAULT 'PUE',
    "subtotalCents" INTEGER NOT NULL,
    "ivaCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "providerUid" TEXT,
    "uuid" TEXT,
    "serie" TEXT,
    "folio" TEXT,
    "stampedAt" TIMESTAMP(3),
    "error" TEXT,
    "decidedBy" TEXT,
    "rejectReason" TEXT,
    "cancelMotivo" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalProfile_organizationId_contactId_rfc_key" ON "FiscalProfile"("organizationId", "contactId", "rfc");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_uuid_key" ON "Invoice"("uuid");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_createdAt_idx" ON "Invoice"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- AddForeignKey
ALTER TABLE "InvoicingSettings" ADD CONSTRAINT "InvoicingSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fiscalProfileId_fkey" FOREIGN KEY ("fiscalProfileId") REFERENCES "FiscalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "InvoiceRequest" (
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceRequest_pkey" PRIMARY KEY ("conversationId")
);

-- CreateIndex
CREATE INDEX "InvoiceRequest_expiresAt_idx" ON "InvoiceRequest"("expiresAt");

