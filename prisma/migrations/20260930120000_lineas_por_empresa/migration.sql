-- Un número de WhatsApp por empresa: la línea (sesión del gateway) y el
-- número que quedó vinculado. Solo agrega columnas nulas: las empresas que
-- no conecten número siguen atendiéndose por el principal, como hoy.
ALTER TABLE "Organization" ADD COLUMN "waLineId" TEXT,
ADD COLUMN "waNumber" TEXT;

CREATE UNIQUE INDEX "Organization_waLineId_key" ON "Organization"("waLineId");
