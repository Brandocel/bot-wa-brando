-- Una PERSONA entrega todo lo de su carpeta: lo que el clasificador dejó
-- fuera o en revisión pasa a entregable. Lo sensible y lo que rechazó una
-- persona a mano no se toca.
UPDATE "Document" d
SET "status" = 'INDEXED', "docClass" = 'ENTREGABLE'
FROM "Organization" o
WHERE d."organizationId" = o."id"
  AND o."kind" = 'PERSONA'
  AND d."status" IN ('EXCLUDED', 'QUARANTINE')
  AND (d."docClass" IS NULL OR d."docClass" <> 'SENSIBLE')
  AND (d."classifiedBy" IS NULL OR d."classifiedBy" <> 'operador' OR d."status" = 'QUARANTINE');
