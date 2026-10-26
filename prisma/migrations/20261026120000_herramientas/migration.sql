-- CreateEnum
CREATE TYPE "Herramienta" AS ENUM ('DOCUMENTOS', 'VENTAS', 'FACTURACION', 'VOZ');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "herramientas" "Herramienta"[] DEFAULT ARRAY['DOCUMENTOS']::"Herramienta"[];


-- Lo que cada empresa ya usaba sigue funcionando: Documentos para todas
-- (el valor por omisión), Ventas a quien ya vendía, Facturación a quien ya
-- timbraba, y Voz a las personas (es donde se está probando la alfa).
UPDATE "Organization" o SET "herramientas" = array_append(o."herramientas", 'VENTAS')
FROM "SalesSettings" s WHERE s."organizationId" = o."id" AND s."enabled" = true;

UPDATE "Organization" o SET "herramientas" = array_append(o."herramientas", 'FACTURACION')
FROM "InvoicingSettings" i WHERE i."organizationId" = o."id" AND i."enabled" = true;

UPDATE "Organization" SET "herramientas" = array_append("herramientas", 'VOZ') WHERE "kind" = 'PERSONA';
