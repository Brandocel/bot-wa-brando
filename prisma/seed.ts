/**
 * Datos de ejemplo para probar el módulo de soporte sin Drive y sin LLM.
 *
 * Cinco organizaciones, elegidas para que cada una ejerza un camino distinto
 * del control de acceso — incluidos los que deben FALLAR. Un seed en el que
 * todo sale bien no prueba nada: los permisos solo se verifican viendo que
 * niegan lo que tienen que negar.
 *
 *   1. Flores de Paula  — VIEWER verificado con grant de FACTURA. Camino feliz.
 *   2. Pollos Pirata    — MANAGER verificado. Ve todas las categorías.
 *   3. Constructora Vega— VIEWER SIN verificar. Debe dar DENY_UNVERIFIED.
 *   4. Despacho Robles  — VIEWER con grant solo de REPORTE. DENY_NO_GRANT
 *                          si pide una factura.
 *   5. Transportes Nieto— VIEWER con ventana 2026-01..2026-06. DENY_PERIOD
 *                          fuera de ese rango.
 *
 * Además, el número "multi" pertenece a Flores de Paula y a Pollos Pirata,
 * para ejercer la desambiguación: con dos organizaciones y sin decir cuál,
 * el bot tiene que preguntar, nunca elegir la primera.
 *
 * Correr con:  npm run seed
 * Es idempotente: se puede correr las veces que haga falta.
 */

import { PrismaClient, type DocCategory, type MemberRole } from '@prisma/client';

const prisma = new PrismaClient();

/** Periodo en UTC al primer día del mes: la misma convención del parser. */
const period = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1));

/**
 * Números de prueba. SEED_OWNER_WA_ID te mete a ti como ADMIN de la primera
 * organización, que es la forma rápida de probar desde tu propio WhatsApp.
 */
const WA = {
  flores: '5215500000001@c.us',
  pollos: '5215500000002@c.us',
  vega: '5215500000003@c.us',
  robles: '5215500000004@c.us',
  nieto: '5215500000005@c.us',
  multi: '5215500000099@c.us',
} as const;

interface SeedDoc {
  name: string;
  category: DocCategory;
  period: Date | null;
  folio: string | null;
  /** QUARANTINE = existe en Drive pero no es entregable. */
  quarantine?: boolean;
}

interface SeedOrg {
  key: string;
  name: string;
  taxId: string;
  driveFolderId: string;
  members: {
    waId: string;
    displayName: string;
    role: MemberRole;
    verified: boolean;
    grants?: {
      category: DocCategory;
      from?: Date;
      to?: Date;
    }[];
  }[];
  documents: SeedDoc[];
}

const ORGS: SeedOrg[] = [
  {
    key: 'flores',
    name: 'Flores de Paula',
    taxId: 'FDP240101AB1',
    driveFolderId: 'drive-folder-flores-de-paula',
    members: [
      {
        waId: WA.flores,
        displayName: 'Paula (Flores de Paula)',
        role: 'VIEWER',
        verified: true,
        grants: [{ category: 'FACTURA' }, { category: 'COTIZACION' }],
      },
      {
        waId: WA.multi,
        displayName: 'Contador externo',
        role: 'VIEWER',
        verified: true,
        grants: [{ category: 'FACTURA' }],
      },
    ],
    documents: [
      {
        name: 'FACTURA_2026-01_A1001.pdf',
        category: 'FACTURA',
        period: period(2026, 1),
        folio: 'A1001',
      },
      {
        name: 'FACTURA_2026-02_A1002.pdf',
        category: 'FACTURA',
        period: period(2026, 2),
        folio: 'A1002',
      },
      {
        name: 'COTIZACION_2026-02_C220.pdf',
        category: 'COTIZACION',
        period: period(2026, 2),
        folio: 'C220',
      },
      {
        // Sin periodo legible en el nombre: el sincronizador no pudo
        // clasificarlo y por eso NO debe aparecer en ninguna búsqueda.
        name: 'escaneo sin nombre (3).pdf',
        category: 'OTRO',
        period: null,
        folio: null,
        quarantine: true,
      },
    ],
  },
  {
    key: 'pollos',
    name: 'Pollos Pirata',
    taxId: 'PPI230515XY2',
    driveFolderId: 'drive-folder-pollos-pirata',
    members: [
      {
        waId: WA.pollos,
        displayName: 'Gerente Pollos Pirata',
        role: 'MANAGER',
        verified: true,
      },
      {
        waId: WA.multi,
        displayName: 'Contador externo',
        role: 'VIEWER',
        verified: true,
        grants: [{ category: 'FACTURA' }],
      },
    ],
    documents: [
      {
        name: 'FACTURA_2026-02_B2001.pdf',
        category: 'FACTURA',
        period: period(2026, 2),
        folio: 'B2001',
      },
      {
        name: 'CONTRATO_2025-11_arrendamiento.pdf',
        category: 'CONTRATO',
        period: period(2025, 11),
        folio: null,
      },
      {
        name: 'REPORTE_2026-02_ventas.pdf',
        category: 'REPORTE',
        period: period(2026, 2),
        folio: null,
      },
    ],
  },
  {
    key: 'vega',
    name: 'Constructora Vega',
    taxId: 'CVE220310LM3',
    driveFolderId: 'drive-folder-constructora-vega',
    members: [
      {
        // Sin verificar: conserva la membresía pero pierde todo lo sensible.
        waId: WA.vega,
        displayName: 'Obra Vega (sin verificar)',
        role: 'VIEWER',
        verified: false,
        grants: [{ category: 'FACTURA' }, { category: 'REPORTE' }],
      },
    ],
    documents: [
      {
        name: 'FACTURA_2026-02_V3001.pdf',
        category: 'FACTURA',
        period: period(2026, 2),
        folio: 'V3001',
      },
      {
        name: 'REPORTE_2026-02_avance-obra.pdf',
        category: 'REPORTE',
        period: period(2026, 2),
        folio: null,
      },
    ],
  },
  {
    key: 'robles',
    name: 'Despacho Robles',
    taxId: 'DRO190822QW4',
    driveFolderId: 'drive-folder-despacho-robles',
    members: [
      {
        waId: WA.robles,
        displayName: 'Asistente Robles',
        role: 'VIEWER',
        verified: true,
        grants: [{ category: 'REPORTE' }],
      },
    ],
    documents: [
      {
        // Existe, pero este número no tiene grant de FACTURA: debe responder
        // "no encontré", nunca "no tienes permiso".
        name: 'FACTURA_2026-02_R4001.pdf',
        category: 'FACTURA',
        period: period(2026, 2),
        folio: 'R4001',
      },
      {
        name: 'REPORTE_2026-01_horas.pdf',
        category: 'REPORTE',
        period: period(2026, 1),
        folio: null,
      },
    ],
  },
  {
    key: 'nieto',
    name: 'Transportes Nieto',
    taxId: 'TNI210204ZX5',
    driveFolderId: 'drive-folder-transportes-nieto',
    members: [
      {
        waId: WA.nieto,
        displayName: 'Logística Nieto',
        role: 'VIEWER',
        verified: true,
        grants: [
          {
            category: 'FACTURA',
            from: period(2026, 1),
            to: period(2026, 6),
          },
        ],
      },
    ],
    documents: [
      {
        name: 'FACTURA_2025-12_N5001.pdf',
        category: 'FACTURA',
        period: period(2025, 12),
        folio: 'N5001',
      },
      {
        name: 'FACTURA_2026-03_N5002.pdf',
        category: 'FACTURA',
        period: period(2026, 3),
        folio: 'N5002',
      },
      {
        name: 'POLIZA_2026-01_flotilla.pdf',
        category: 'POLIZA',
        period: period(2026, 1),
        folio: null,
      },
    ],
  },
];

async function main(): Promise<void> {
  for (const org of ORGS) {
    /**
     * Se busca por RFC, no por carpeta de Drive.
     *
     * La carpeta cambia: es lo primero que se corrige al conectar una
     * empresa de verdad. Buscando por ella, el seed no reconocía la empresa
     * ya existente e intentaba crear otra con el mismo RFC — que revienta
     * por la restricción de unicidad.
     *
     * Y sobre todo: a una empresa que ya existe NO se le toca la carpeta.
     * Volver a correr el seed no puede deshacer la configuración real de
     * alguien, que es exactamente lo que habría pasado aquí.
     */
    const existente = await prisma.organization.findFirst({
      where: { OR: [{ taxId: org.taxId }, { name: org.name }] },
    });

    const organization = existente
      ? await prisma.organization.update({
          where: { id: existente.id },
          data: { active: true },
        })
      : await prisma.organization.create({
          data: {
            name: org.name,
            taxId: org.taxId,
            driveFolderId: org.driveFolderId,
          },
        });

    for (const member of org.members) {
      const contact = await prisma.contact.upsert({
        where: { waId: member.waId },
        create: { waId: member.waId, displayName: member.displayName },
        update: { displayName: member.displayName },
      });

      const membership = await prisma.membership.upsert({
        where: {
          contactId_organizationId: {
            contactId: contact.id,
            organizationId: organization.id,
          },
        },
        create: {
          contactId: contact.id,
          organizationId: organization.id,
          role: member.role,
          verifiedAt: member.verified ? new Date() : null,
        },
        update: {
          role: member.role,
          verifiedAt: member.verified ? new Date() : null,
          revokedAt: null,
        },
      });

      for (const grant of member.grants ?? []) {
        await prisma.accessGrant.upsert({
          where: {
            membershipId_category: {
              membershipId: membership.id,
              category: grant.category,
            },
          },
          create: {
            membershipId: membership.id,
            category: grant.category,
            periodFrom: grant.from ?? null,
            periodTo: grant.to ?? null,
            grantedBy: 'seed',
          },
          update: {
            periodFrom: grant.from ?? null,
            periodTo: grant.to ?? null,
            revokedAt: null,
          },
        });
      }
    }

    // Si la empresa ya está conectada a una carpeta de Drive real, sus
    // documentos salen de ahí. Sembrar los ficticios encima haría que el bot
    // prometiera archivos que no existen — que es justo el fallo que costó
    // una tarde entender.
    const conectadaAdrive = !organization.driveFolderId.startsWith('drive-folder-');

    if (conectadaAdrive) {
      console.log(
        `↷ ${org.name}: conectada a Drive, no se siembran documentos de prueba`,
      );
    }

    for (const doc of conectadaAdrive ? [] : org.documents) {
      const driveFileId = `drive-${org.key}-${doc.name}`;

      await prisma.document.upsert({
        where: { driveFileId },
        create: {
          organizationId: organization.id,
          driveFileId,
          driveVersion: '1',
          name: doc.name,
          mimeType: 'application/pdf',
          sizeBytes: 120_000,
          category: doc.category,
          period: doc.period,
          folio: doc.folio,
          status: doc.quarantine ? 'QUARANTINE' : 'INDEXED',
          extractedText: `Documento de ejemplo de ${org.name}: ${doc.name}`,
        },
        update: {
          status: doc.quarantine ? 'QUARANTINE' : 'INDEXED',
          category: doc.category,
          period: doc.period,
          folio: doc.folio,
        },
      });
    }

    console.log(
      `✓ ${org.name}: ${org.members.length} miembro(s), ${org.documents.length} documento(s)`,
    );
  }

  // Tu propio número como ADMIN de la primera organización, para poder probar
  // desde WhatsApp sin inventar contactos.
  const ownerWaId = process.env.SEED_OWNER_WA_ID ?? process.env.OWNER_WA_ID;

  if (ownerWaId) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { driveFolderId: ORGS[0]!.driveFolderId },
    });
    const contact = await prisma.contact.upsert({
      where: { waId: ownerWaId },
      create: { waId: ownerWaId, displayName: 'Owner', role: 'OWNER' },
      update: {},
    });

    await prisma.membership.upsert({
      where: {
        contactId_organizationId: {
          contactId: contact.id,
          organizationId: organization.id,
        },
      },
      create: {
        contactId: contact.id,
        organizationId: organization.id,
        role: 'ADMIN',
        verifiedAt: new Date(),
      },
      update: { role: 'ADMIN', verifiedAt: new Date(), revokedAt: null },
    });

    console.log(`✓ ${ownerWaId} dado de alta como ADMIN de ${organization.name}`);
  } else {
    console.log(
      'ℹ Sin OWNER_WA_ID: no se dio de alta tu número. Ponlo en .env y vuelve a correr.',
    );
  }

  console.log('\nPruebas sugeridas (escribiéndolas desde cada número):');
  console.log(`  ${WA.flores}  /buscar factura febrero 2026   → la entrega`);
  console.log(`  ${WA.vega}    /buscar factura febrero 2026   → niega: sin verificar`);
  console.log(`  ${WA.robles}  /buscar factura febrero 2026   → niega: sin grant`);
  console.log(`  ${WA.nieto}   /buscar factura diciembre 2025 → niega: fuera de periodo`);
  console.log(`  ${WA.multi}   /buscar factura febrero 2026   → pregunta de cuál empresa`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
