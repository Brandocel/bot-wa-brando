/**
 * Alta de una cuenta del panel.
 *
 * Existe porque el primer usuario no puede crearse desde el panel: no hay
 * con qué entrar. Y no se siembra una cuenta por defecto a propósito —
 * "admin/admin" en un sistema que sirve facturas es una puerta abierta que
 * nadie se acuerda de cerrar.
 *
 * Uso:
 *   npm run panel:user -- correo@ejemplo.com "Nombre" ADMIN
 *
 * La contraseña se pide por teclado y no se ve al escribirla; pasarla como
 * argumento la dejaría en el historial del shell y en la lista de procesos.
 */
import 'dotenv/config';
import { createInterface } from 'node:readline';
import { PrismaClient, type PanelRole } from '@prisma/client';
import { PanelAuthService } from '../../apps/agent-core/src/infrastructure/http/panel/panel-auth.service';

const prisma = new PrismaClient();
const auth = new PanelAuthService(prisma as never);

/**
 * Pide algo por teclado sin que se vea al escribirlo.
 *
 * La pregunta se imprime ANTES de crear el readline. Interceptando
 * `_writeToOutput` se silencia todo lo que readline escribe — y la pregunta
 * también, con lo que quedaba un cursor parpadeando en una línea vacía sin
 * ninguna pista de qué se esperaba.
 */
function askHidden(question: string): Promise<string> {
  process.stdout.write(question);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput =
    () => {
      // Ni la contraseña ni asteriscos: nada. Así no se filtra ni su longitud.
    };

  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const [email, name, roleRaw] = process.argv.slice(2);

  if (!email || !name) {
    console.error('Uso: npm run panel:user -- correo@ejemplo.com "Nombre" [ADMIN|AGENTE]');
    process.exitCode = 1;
    return;
  }

  const role: PanelRole = roleRaw === 'ADMIN' ? 'ADMIN' : 'AGENTE';

  const existing = await prisma.panelUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (existing) {
    console.error(`Ya existe una cuenta con ${email}.`);
    process.exitCode = 1;
    return;
  }

  // Dos líneas y no una: con solo "Contraseña:" y sin eco, la terminal
  // parece colgada. Decir explícitamente que no se va a ver nada es la
  // diferencia entre esperar y darle Ctrl+C.
  console.log(`Creando cuenta ${role} para ${email}`);
  console.log('Escribe la contraseña y pulsa Enter. No se verá nada al teclear.');

  const password = await askHidden('> ');

  if (password.length < 10) {
    console.error('Muy corta. Mínimo 10 caracteres.');
    process.exitCode = 1;
    return;
  }

  const user = await auth.createUser({ email, name, password, role });

  console.log(`✓ ${user.email} creada como ${user.role}`);
  console.log('Entra en: https://TU-URL-DE-AGENT-CORE/panel');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
