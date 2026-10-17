import type { DocCategory } from '@prisma/client';

/**
 * El archivero de la demo pública: los papeles de una persona inventada.
 *
 * Vive en memoria y no toca la base: la demo nunca ve documentos reales.
 * `cajon` es el cajón del dibujo de la web (jarvis-web,
 * components/figures/archivero/model.ts): así la página sabe cuál abrir.
 */
export interface DocDemo {
  id: string;
  nombre: string;
  tipo: DocCategory;
  /** "YYYY-MM". */
  mes: string;
  titular?: string;
  resumen?: string;
  cajon: number;
}

/** Los cajones del dibujo, en su orden. */
export const CAJON = { factura: 0, contrato: 1, poliza: 2, estado: 3, recibo: 4, identificacion: 5, fiscal: 6, otro: 7 } as const;

export const TITULAR_DEMO = 'Mariana Torres Ruiz';

const d = (id: string, nombre: string, tipo: DocCategory, mes: string, cajon: number, resumen?: string, titular?: string): DocDemo => ({
  id,
  nombre,
  tipo,
  mes,
  cajon,
  resumen,
  titular,
});

export const ARCHIVERO_DEMO: readonly DocDemo[] = [
  d('f1', 'Factura Telcel julio 2026.pdf', 'FACTURA', '2026-07', CAJON.factura, 'Plan Telcel Max, $599', 'Radiomóvil Dipsa'),
  d('f2', 'Factura Liverpool refrigerador.pdf', 'FACTURA', '2026-05', CAJON.factura, 'Refrigerador Mabe 14 pies, $13,499', 'Liverpool'),
  d('f3', 'Factura Home Depot pintura.pdf', 'FACTURA', '2026-03', CAJON.factura, 'Pintura y material, $2,180', 'Home Depot'),
  d('f4', 'Factura gasolina agosto 2026.pdf', 'FACTURA', '2026-08', CAJON.factura, 'Gasolina, 4 cargas, $3,240', 'Pemex'),
  d('c1', 'Contrato arrendamiento depto Narvarte.pdf', 'CONTRATO', '2025-11', CAJON.contrato, 'Renta $14,500 al mes, 12 meses', 'Inmobiliaria Roma'),
  d('c2', 'Contrato laboral Grupo Sigma.pdf', 'CONTRATO', '2023-06', CAJON.contrato, 'Puesto: analista de compras', 'Grupo Sigma'),
  d('c3', 'Contrato plan Telcel.pdf', 'CONTRATO', '2024-02', CAJON.contrato, 'Plan a 24 meses', 'Radiomóvil Dipsa'),
  d('p1', 'Póliza seguro auto Qualitas.pdf', 'POLIZA', '2026-01', CAJON.poliza, 'Cobertura amplia, Mazda 3 2021', 'Quálitas'),
  d('p2', 'Póliza gastos médicos GNP.pdf', 'POLIZA', '2026-04', CAJON.poliza, 'Gastos médicos mayores, individual', 'GNP Seguros'),
  d('e1', 'Estado de cuenta BBVA julio 2026.pdf', 'ESTADO_CUENTA', '2026-07', CAJON.estado, 'Cuenta de nómina', 'BBVA'),
  d('e2', 'Estado de cuenta BBVA agosto 2026.pdf', 'ESTADO_CUENTA', '2026-08', CAJON.estado, 'Cuenta de nómina', 'BBVA'),
  d('e3', 'Estado de cuenta BBVA septiembre 2026.pdf', 'ESTADO_CUENTA', '2026-09', CAJON.estado, 'Cuenta de nómina', 'BBVA'),
  d('e4', 'Estado de cuenta tarjeta Banamex septiembre 2026.pdf', 'ESTADO_CUENTA', '2026-09', CAJON.estado, 'Tarjeta de crédito Oro', 'Banamex'),
  d('e5', 'Estado de cuenta Afore.pdf', 'ESTADO_CUENTA', '2026-06', CAJON.estado, 'Ahorro para el retiro', 'Afore XXI Banorte'),
  d('r1', 'Recibo CFE marzo 2026.pdf', 'OTRO', '2026-03', CAJON.recibo, 'Recibo de luz, $412', 'CFE'),
  d('r2', 'Recibo CFE mayo 2026.pdf', 'OTRO', '2026-05', CAJON.recibo, 'Recibo de luz, $538', 'CFE'),
  d('r3', 'Recibo CFE julio 2026.pdf', 'OTRO', '2026-07', CAJON.recibo, 'Recibo de luz, $611', 'CFE'),
  d('r4', 'Recibo agua SACMEX.pdf', 'OTRO', '2026-06', CAJON.recibo, 'Recibo de agua, bimestral', 'SACMEX'),
  d('r5', 'Recibo predial 2026.pdf', 'OTRO', '2026-01', CAJON.recibo, 'Predial anual pagado', 'Tesorería CDMX'),
  d('r6', 'Recibo Izzi internet septiembre 2026.pdf', 'OTRO', '2026-09', CAJON.recibo, 'Internet 100 megas', 'Izzi'),
  d('i1', 'INE.pdf', 'OTRO', '2024-08', CAJON.identificacion, 'Credencial para votar, frente y vuelta', TITULAR_DEMO),
  d('i2', 'Pasaporte.pdf', 'OTRO', '2022-10', CAJON.identificacion, 'Vigente hasta 2028', TITULAR_DEMO),
  d('i3', 'Acta de nacimiento.pdf', 'OTRO', '2021-02', CAJON.identificacion, 'Copia certificada', TITULAR_DEMO),
  d('i4', 'CURP.pdf', 'OTRO', '2024-08', CAJON.identificacion, 'Constancia de CURP', TITULAR_DEMO),
  d('i5', 'Licencia de conducir.pdf', 'OTRO', '2025-03', CAJON.identificacion, 'Tipo A, CDMX', TITULAR_DEMO),
  d('s1', 'Constancia de situación fiscal.pdf', 'CONTABLE', '2026-09', CAJON.fiscal, 'Régimen de sueldos y salarios', 'SAT'),
  d('s2', 'Declaración anual 2025.pdf', 'CONTABLE', '2026-04', CAJON.fiscal, 'Saldo a favor $3,870', 'SAT'),
  d('s3', 'Opinión de cumplimiento SAT.pdf', 'CONTABLE', '2026-09', CAJON.fiscal, 'Opinión positiva', 'SAT'),
  d('o1', 'Título profesional.pdf', 'OTRO', '2019-09', CAJON.otro, 'Licenciatura en Administración', 'UNAM'),
  d('o2', 'Cédula profesional.pdf', 'OTRO', '2019-12', CAJON.otro, undefined, 'SEP'),
  d('o3', 'Comprobante de vacunación.pdf', 'OTRO', '2022-01', CAJON.otro, undefined, TITULAR_DEMO),
];

/** Sin acentos ni mayúsculas, para que "poliza" encuentre "Póliza". */
const plano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Palabras que no sirven para buscar: "el recibo de la luz" busca "recibo" y "luz". */
const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'mi', 'mis', 'un', 'una', 'y', 'en', 'por', 'para', 'con', 'al', 'pdf']);

/** Sinónimos de lo que la gente escribe contra cómo se llaman los archivos. */
const SINONIMOS: Record<string, string[]> = {
  luz: ['cfe'],
  credencial: ['ine'],
  identificacion: ['ine'],
  renta: ['arrendamiento'],
  seguro: ['poliza'],
  banco: ['estado de cuenta'],
  sat: ['sat', 'fiscal'],
  rfc: ['situacion fiscal'],
};

export interface Consulta {
  texto: string | null;
  tipo: DocCategory | null;
  mes: string | null;
}

/** La búsqueda: tipo y mes exactos; del texto, cada palabra (o un sinónimo) tiene que aparecer. */
export function buscarDemo(docs: readonly DocDemo[], q: Consulta): DocDemo[] {
  const palabras = q.texto
    ? plano(q.texto)
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length > 1 && !VACIAS.has(p))
    : [];
  return docs
    .filter((doc) => {
      if (q.tipo && doc.tipo !== q.tipo) return false;
      if (q.mes && doc.mes !== q.mes) return false;
      const pajar = plano(`${doc.nombre} ${doc.titular ?? ''} ${doc.resumen ?? ''}`);
      return palabras.every((p) => pajar.includes(p) || (SINONIMOS[p] ?? []).some((s) => pajar.includes(s)));
    })
    .sort((a, b) => b.mes.localeCompare(a.mes));
}

/** Cuántos hay de cada tipo y de qué fechas. */
export function inventarioDemo(docs: readonly DocDemo[]) {
  const porTipo = new Map<DocCategory, DocDemo[]>();
  for (const doc of docs) porTipo.set(doc.tipo, [...(porTipo.get(doc.tipo) ?? []), doc]);
  return [...porTipo.entries()].map(([tipo, lista]) => {
    const meses = lista.map((x) => x.mes).sort();
    return { tipo, cuantos: lista.length, desde: meses[0], hasta: meses[meses.length - 1] };
  });
}
