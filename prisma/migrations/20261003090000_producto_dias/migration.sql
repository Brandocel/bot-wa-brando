-- Días de venta por producto ("Súper Miércoles").
--
-- La columna se había agregado editando la migración 20261002210000_ventas
-- cuando ya estaba aplicada en producción: Prisma no vuelve a correr una
-- migración aplicada, así que la columna nunca llegó a la base y toda
-- consulta al catálogo fallaba. Va aquí, en una migración propia.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "availableDays" TEXT[] DEFAULT ARRAY[]::TEXT[];
