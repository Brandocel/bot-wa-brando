-- Nombre completo registrado y su confirmación por WhatsApp.
ALTER TABLE "Membership" ADD COLUMN "fullName" TEXT,
ADD COLUMN "nameConfirmedAt" TIMESTAMP(3);

-- Titular normalizado del documento: filtra lo que ve cada VIEWER.
ALTER TABLE "Document" ADD COLUMN "holderKey" TEXT,
ADD COLUMN "holderByOperator" BOOLEAN NOT NULL DEFAULT false;

-- Lo ya indexado: la misma regla que claveTitular() en
-- apps/agent-core/src/domain/contact/nombre.ts (minúsculas, sin acentos,
-- solo letras y números, sin partículas, palabras entre espacios).
UPDATE "Document" d SET "holderKey" = k.clave
FROM (
  SELECT "id",
    NULLIF(
      ' ' || btrim(regexp_replace(
        regexp_replace(
          ' ' || regexp_replace(
            translate(lower("counterpart"), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9]+', ' ', 'g'
          ) || ' ',
          ' (de|del|la|las|los|y|e)(?= )', ' ', 'g'
        ),
        ' +', ' ', 'g'
      )) || ' ',
      '  '
    ) AS clave
  FROM "Document"
  WHERE "counterpart" IS NOT NULL
) k
WHERE d."id" = k."id";
