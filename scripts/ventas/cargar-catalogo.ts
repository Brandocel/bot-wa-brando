/**
 * Carga el catálogo de ventas de una empresa desde un JSON.
 *
 * Uso:
 *   npm run ventas:catalogo -- scripts/ventas/pollos-pirata.json            (solo muestra qué haría)
 *   npm run ventas:catalogo -- scripts/ventas/pollos-pirata.json --aplicar  (escribe)
 *
 * - La empresa se busca por nombre exacto; tiene que existir.
 * - Los productos se emparejan por nombre: se actualizan o se crean. Los
 *   que ya no vienen en el archivo se marcan "no disponible", no se borran:
 *   los pedidos viejos los siguen nombrando.
 * - La configuración se escribe, pero las ventas NO se encienden aquí:
 *   horario, entrega y WhatsApp propio se revisan en el panel antes.
 *
 * Usa DATABASE_URL del .env. Sin --aplicar no escribe nada.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient, type DeliveryMode } from '@prisma/client';

interface Archivo {
  empresa: string;
  config?: {
    businessType?: string;
    pitch?: string;
    timezone?: string;
    deliveryModes?: DeliveryMode[];
    prepMinutes?: number;
    minOrder?: number;
    hours?: Record<string, Array<[string, string]>>;
    zones?: Array<{ nombre: string; costo: number }>;
  };
  productos: Array<{ nombre: string; seccion?: string; precio: number; descripcion?: string; dias?: string[] }>;
}

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

async function main(): Promise<void> {
  const [ruta, ...flags] = process.argv.slice(2);
  if (!ruta) throw new Error('falta el archivo: npm run ventas:catalogo -- <archivo.json> [--aplicar]');
  const aplicar = flags.includes('--aplicar');
  const datos = JSON.parse(readFileSync(ruta, 'utf8')) as Archivo;

  // Validar todo antes de tocar la base.
  const nombres = new Set<string>();
  for (const [i, p] of datos.productos.entries()) {
    if (!p.nombre?.trim()) throw new Error(`producto ${i + 1}: falta el nombre`);
    if (!Number.isFinite(p.precio) || p.precio < 0) throw new Error(`${p.nombre}: precio no válido`);
    if (nombres.has(p.nombre.trim())) throw new Error(`${p.nombre}: viene repetido`);
    if (p.dias?.some((d) => !DIAS.includes(d))) throw new Error(`${p.nombre}: día no válido (usa ${DIAS.join(', ')})`);
    nombres.add(p.nombre.trim());
  }

  const prisma = new PrismaClient();
  try {
    const empresa = await prisma.organization.findFirst({ where: { name: datos.empresa }, select: { id: true, name: true, waLineId: true } });
    if (!empresa) throw new Error(`no existe la empresa "${datos.empresa}"`);

    const actuales = await prisma.product.findMany({ where: { organizationId: empresa.id } });
    const porNombre = new Map(actuales.map((p) => [p.name, p]));

    const crear: string[] = [];
    const cambiar: string[] = [];
    for (const [orden, p] of datos.productos.entries()) {
      const nombre = p.nombre.trim();
      const fila = {
        name: nombre,
        section: p.seccion?.trim() ?? '',
        description: p.descripcion?.trim() ?? '',
        priceCents: Math.round(p.precio * 100),
        availableDays: p.dias ?? [],
        sortOrder: orden,
        active: true,
      };
      const actual = porNombre.get(nombre);
      if (!actual) {
        crear.push(`${nombre} $${p.precio}`);
        if (aplicar) await prisma.product.create({ data: { ...fila, organizationId: empresa.id } });
      } else {
        if (actual.priceCents !== fila.priceCents) cambiar.push(`${nombre}: $${actual.priceCents / 100} → $${p.precio}`);
        if (aplicar) await prisma.product.update({ where: { id: actual.id }, data: fila });
      }
    }

    const apagar = actuales.filter((p) => p.active && !nombres.has(p.name)).map((p) => p.name);
    if (aplicar && apagar.length) {
      await prisma.product.updateMany({ where: { organizationId: empresa.id, name: { in: apagar } }, data: { active: false } });
    }

    if (datos.config && aplicar) {
      const c = datos.config;
      const config = {
        ...(c.businessType !== undefined ? { businessType: c.businessType } : {}),
        ...(c.pitch !== undefined ? { pitch: c.pitch } : {}),
        ...(c.timezone ? { timezone: c.timezone } : {}),
        ...(c.deliveryModes ? { deliveryModes: c.deliveryModes } : {}),
        ...(c.prepMinutes ? { prepMinutes: c.prepMinutes } : {}),
        ...(c.minOrder !== undefined ? { minOrder: c.minOrder } : {}),
        ...(c.hours ? { hours: c.hours } : {}),
        ...(c.zones ? { zones: c.zones } : {}),
      };
      await prisma.salesSettings.upsert({
        where: { organizationId: empresa.id },
        create: { organizationId: empresa.id, enabled: false, ...config },
        update: config,
      });
    }

    console.log(`${empresa.name}: ${aplicar ? 'APLICADO' : 'vista previa (agrega --aplicar para escribir)'}`);
    console.log(`  nuevos: ${crear.length}${crear.length ? '\n    ' + crear.join('\n    ') : ''}`);
    console.log(`  precios que cambian: ${cambiar.length}${cambiar.length ? '\n    ' + cambiar.join('\n    ') : ''}`);
    console.log(`  se marcan no disponibles: ${apagar.length}${apagar.length ? '\n    ' + apagar.join('\n    ') : ''}`);
    if (!empresa.waLineId) console.log('  OJO: la empresa no tiene WhatsApp propio conectado; sin eso las ventas no se pueden activar.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
