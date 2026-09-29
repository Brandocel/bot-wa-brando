-- Hasta ahora los estados de cuenta y los reportes contables se indexaban
-- como REPORTE. Quien tenía permiso de REPORTE los veía; al separarlos en
-- categorías propias, ese permiso se copia para no quitarle a nadie lo que
-- ya podía consultar. Va en una migración aparte porque un valor de enum
-- recién agregado no se puede usar en la misma transacción.
INSERT INTO "AccessGrant" ("id", "membershipId", "category", "periodFrom", "periodTo", "grantedBy", "createdAt", "revokedAt")
SELECT 'mig' || md5(g."id" || nueva.categoria), g."membershipId", nueva.categoria::"DocCategory",
       g."periodFrom", g."periodTo", g."grantedBy", CURRENT_TIMESTAMP, g."revokedAt"
FROM "AccessGrant" g
CROSS JOIN (VALUES ('ESTADO_CUENTA'), ('CONTABLE')) AS nueva(categoria)
WHERE g."category" = 'REPORTE'
ON CONFLICT ("membershipId", "category") DO NOTHING;
