-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('RECOGER', 'DOMICILIO', 'PAQUETERIA', 'DIGITAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ARMANDO', 'POR_ACEPTAR', 'ACEPTADO', 'RECHAZADO', 'ENTREGADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "SalesSettings" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessType" TEXT NOT NULL DEFAULT '',
    "pitch" TEXT NOT NULL DEFAULT '',
    "hours" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "deliveryModes" "DeliveryMode"[],
    "zones" JSONB NOT NULL DEFAULT '[]',
    "prepMinutes" INTEGER NOT NULL DEFAULT 30,
    "minOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "section" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL,
    "availableDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'ARMANDO',
    "buyingScore" INTEGER,
    "confirmPending" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL DEFAULT '[]',
    "deliveryMode" "DeliveryMode",
    "address" TEXT,
    "zone" TEXT,
    "deliveryCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "customerName" TEXT,
    "notes" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_organizationId_active_idx" ON "Product"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_createdAt_idx" ON "Order"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_conversationId_status_idx" ON "Order"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- AddForeignKey
ALTER TABLE "SalesSettings" ADD CONSTRAINT "SalesSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Lectura de venta de cada mensaje entrante.
ALTER TABLE "Message" ADD COLUMN "salesEmotion" TEXT,
ADD COLUMN "salesIntensity" INTEGER,
ADD COLUMN "salesStage" TEXT,
ADD COLUMN "salesScore" INTEGER,
ADD COLUMN "salesSignal" TEXT;
