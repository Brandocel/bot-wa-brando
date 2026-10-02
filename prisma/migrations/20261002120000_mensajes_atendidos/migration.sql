-- Un entrante registrado ya no cuenta como "procesado": solo el que tiene
-- handledAt. Así un reintento tras una falla al responder no se descarta.
ALTER TABLE "Message" ADD COLUMN "waTimestamp" TIMESTAMP(3),
ADD COLUMN "handledAt" TIMESTAMP(3);

-- Lo que ya estaba en la base se da por atendido: no se reprocesa nada viejo.
UPDATE "Message" SET "handledAt" = "createdAt", "waTimestamp" = "createdAt" WHERE "direction" = 'IN';
