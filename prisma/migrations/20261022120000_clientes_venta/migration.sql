-- CreateEnum
CREATE TYPE "EtapaCliente" AS ENUM ('NUEVO', 'PROSPECTO', 'COMPRADOR', 'RECURRENTE', 'EN_RIESGO', 'PERDIDO');

-- CreateTable
CREATE TABLE "PerfilCliente" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "etapa" "EtapaCliente" NOT NULL DEFAULT 'NUEVO',
    "nombre" TEXT,
    "primerContactoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoContactoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoPedidoAt" TIMESTAMP(3),
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "gastoCents" INTEGER NOT NULL DEFAULT 0,
    "ticketPromedioCents" INTEGER NOT NULL DEFAULT 0,
    "frecuenciaDias" INTEGER,
    "entregaPreferida" "DeliveryMode",
    "zonaPreferida" TEXT,
    "direccionHabitual" TEXT,
    "horaHabitual" INTEGER,
    "diasHabituales" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ultimaEmocion" TEXT,
    "ultimoScore" INTEGER,
    "sentimiento" INTEGER,
    "tendencia" TEXT,
    "emocionDominante" TEXT,
    "puntaje" INTEGER NOT NULL DEFAULT 0,
    "segmento" TEXT NOT NULL DEFAULT 'NUEVO',
    "rfm" TEXT,
    "proximaAccion" TEXT,
    "proximaAccionAt" TIMESTAMP(3),
    "notas" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoCliente" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalle" JSONB NOT NULL DEFAULT '{}',
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciaCliente" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "producto" TEXT NOT NULL,
    "productId" TEXT,
    "veces" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ultimaVez" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerfilCliente_organizationId_etapa_idx" ON "PerfilCliente"("organizationId", "etapa");

-- CreateIndex
CREATE INDEX "PerfilCliente_organizationId_segmento_idx" ON "PerfilCliente"("organizationId", "segmento");

-- CreateIndex
CREATE INDEX "PerfilCliente_organizationId_proximaAccionAt_idx" ON "PerfilCliente"("organizationId", "proximaAccionAt");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilCliente_organizationId_contactId_key" ON "PerfilCliente"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "EventoCliente_organizationId_contactId_createdAt_idx" ON "EventoCliente"("organizationId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "EventoCliente_organizationId_tipo_createdAt_idx" ON "EventoCliente"("organizationId", "tipo", "createdAt");

-- CreateIndex
CREATE INDEX "PreferenciaCliente_organizationId_contactId_idx" ON "PreferenciaCliente"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenciaCliente_organizationId_contactId_producto_key" ON "PreferenciaCliente"("organizationId", "contactId", "producto");

-- AddForeignKey
ALTER TABLE "PerfilCliente" ADD CONSTRAINT "PerfilCliente_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilCliente" ADD CONSTRAINT "PerfilCliente_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCliente" ADD CONSTRAINT "EventoCliente_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCliente" ADD CONSTRAINT "EventoCliente_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaCliente" ADD CONSTRAINT "PreferenciaCliente_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaCliente" ADD CONSTRAINT "PreferenciaCliente_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

