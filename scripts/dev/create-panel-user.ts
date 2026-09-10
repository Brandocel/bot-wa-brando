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

function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // readline hace eco de todo lo que se teclea. Se intercepta la escritura
  // para que la contraseña no quede en pantalla ni en la terminal.
  const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
  let visible = true;

  (output as { _writeToOutput: (text: string) => void })._writeToOutput = (text) => {
    if (visible) output.output.write(text);
    else output.output.write('');
  };

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    visible = false;
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

  const password = await askHidden('Contraseña: ');

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
