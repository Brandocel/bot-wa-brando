/**
 * Prueba de punta a punta contra el SANDBOX de Factura.com: series, timbrar
 * una factura de $1.16 a un receptor de prueba del SAT (ESCUELA KEMPER
 * URGATE), descargar PDF y XML y cancelarla. Los CFDI del sandbox no tienen validez fiscal.
 *
 * Usa el mismo adaptador que el bot, así que si esto pasa, el bot habla
 * bien con Factura.com. Lo que falla aquí falla igual en producción.
 *
 * Las llaves salen del entorno (.env), nunca de la línea de comandos:
 *   FACTURACOM_SANDBOX_API_KEY=...
 *   FACTURACOM_SANDBOX_SECRET_KEY=...
 *
 * Correr con: npm run verify:facturacion
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armarConceptos } from '../../apps/agent-core/src/application/facturacion/conceptos';
import { erroresDeReceptor, type Receptor } from '../../apps/agent-core/src/application/facturacion/validacion';
import { ErrorPac, type CredencialesPac } from '../../apps/agent-core/src/application/ports/facturacion.port';
import { FacturaComAdapter } from '../../apps/agent-core/src/infrastructure/facturacion/factura-com.adapter';

async function main(): Promise<void> {
  const apiKey = process.env.FACTURACOM_SANDBOX_API_KEY;
  const secretKey = process.env.FACTURACOM_SANDBOX_SECRET_KEY;
  if (!apiKey || !secretKey) {
    console.error('Faltan FACTURACOM_SANDBOX_API_KEY y FACTURACOM_SANDBOX_SECRET_KEY en .env');
    process.exit(1);
  }
  const cred: CredencialesPac = { apiKey, secretKey, sandbox: true };
  const pac = new FacturaComAdapter();

  console.log('1. Series…');
  const series = await pac.series(cred);
  console.table(series);
  const serie = series.find((s) => s.tipo === 'factura' && s.activa);
  if (!serie) throw new Error('No hay serie activa de tipo factura: créala en Configuraciones → Series y folios');

  const receptor: Receptor = {
    // Receptor del padrón de pruebas del SAT: el sandbox valida nombre y CP contra él.
    rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', codigoPostal: '42501', regimen: '601', usoCfdi: 'G03',
  };
  const errores = erroresDeReceptor(receptor);
  if (errores.length) throw new Error(errores.join(' '));

  const { conceptos, totalCents } = armarConceptos(
    [{ nombre: 'Prueba de integración del bot', precioCents: 116, cantidad: 1 }],
    0,
    { preciosConIva: true, tasaIva: 0.16, claveProdServ: '01010101', claveUnidad: 'H87', claveProdServEnvio: '78102203' },
  );

  console.log(`2. Timbrando $${(totalCents / 100).toFixed(2)} con serie ${serie.nombre} (${serie.id})…`);
  const t = await pac.timbrar(cred, {
    receptor, conceptos, serieId: serie.id, formaPago: '03', metodoPago: 'PUE', emailRespaldo: 'pruebas@example.com', referencia: `verify-${Date.now()}`,
  });
  console.log(t);

  console.log('3. Descargando PDF y XML…');
  const dir = join(process.cwd(), 'data', 'verify-facturacion');
  mkdirSync(dir, { recursive: true });
  for (const f of ['pdf', 'xml'] as const) {
    const buf = await pac.descargar(cred, t.uidProveedor, f);
    const ruta = join(dir, `${t.uuid}.${f}`);
    writeFileSync(ruta, buf);
    console.log(`   ${f}: ${buf.length} bytes → ${ruta}`);
  }

  console.log('4. Cancelando (motivo 02)…');
  console.log(await pac.cancelar(cred, t.uidProveedor, '02'));
  console.log('\nTodo bien: el adaptador habla con Factura.com.');
}

main().catch((err: unknown) => {
  const extra = err instanceof ErrorPac ? ` [definitivo=${err.definitivo}]` : '';
  console.error(`\nFALLÓ: ${err instanceof Error ? err.message : String(err)}${extra}`);
  process.exit(1);
});
