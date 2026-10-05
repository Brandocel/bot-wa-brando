-- Permiso por número para emitir facturas de la empresa por WhatsApp.
ALTER TABLE "Membership" ADD COLUMN "canInvoice" BOOLEAN NOT NULL DEFAULT false;
