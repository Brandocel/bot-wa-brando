-- Usuarios del panel que pertenecen a UNA empresa: ven y gestionan solo su
-- directorio y sus documentos.
ALTER TYPE "PanelRole" ADD VALUE 'EMPRESA';

ALTER TABLE "PanelUser" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "PanelUser_organizationId_idx" ON "PanelUser"("organizationId");
ALTER TABLE "PanelUser" ADD CONSTRAINT "PanelUser_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
