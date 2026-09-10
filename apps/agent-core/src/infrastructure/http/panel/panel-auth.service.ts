import { Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { PanelRole, PanelUser } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma.service';

/**
 * Autenticación del panel.
 *
 * scrypt de la librería estándar en vez de bcrypt o argon2: los dos son
 * módulos nativos, y en un servicio de Node en Render eso significa
 * compilarlos en cada build o arrastrar binarios precompilados. scrypt está
 * en Node desde la v10, es una función de derivación con costo de memoria
 * —justo lo que hace caro un ataque por GPU— y aquí no hay que elegir entre
 * seguridad y no tener dependencias.
 *
 * Las sesiones viven en la base y no en un JWT porque un JWT firmado sigue
 * siendo válido hasta que caduca aunque desactives al usuario. Del otro lado
 * de este panel hay facturas: revocar tiene que ser inmediato.
 */

/**
 * `promisify` elige la sobrecarga de scrypt sin opciones, así que los
 * parámetros de costo se perderían silenciosamente. Se envuelve a mano para
 * que N, r y p lleguen de verdad.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/**
 * Parámetros de scrypt. N=2^15 es el equilibrio recomendado hoy.
 *
 * `maxmem` NO es decorativo: scrypt necesita 128·N·r bytes, que con estos
 * valores son exactamente 32 MiB, y el tope por defecto de Node son 32 MiB
 * — el margen es cero y la llamada revienta con
 * `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Sin este campo, ningún inicio de
 * sesión funciona: falla al derivar, no al comparar, así que ni siquiera
 * parece un problema de contraseñas.
 */
const SCRYPT = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
};

const SESSION_DAYS = 7;

export const SESSION_COOKIE = 'panel_session';

export interface PanelIdentity {
  id: string;
  email: string;
  name: string;
  role: PanelRole;
}

@Injectable()
export class PanelAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** `sal:hash`, ambos en hexadecimal. */
  async hashPassword(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(plain, salt, SCRYPT.keylen, SCRYPT);
    return `${salt.toString('hex')}:${derived.toString('hex')}`;
  }

  private async verifyPassword(plain: string, stored: string): Promise<boolean> {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;

    const derived = await scryptAsync(
      plain,
      Buffer.from(saltHex, 'hex'),
      SCRYPT.keylen,
      SCRYPT,
    );

    const expected = Buffer.from(hashHex, 'hex');

    // Comparación en tiempo constante: comparar con === filtra información
    // sobre cuántos bytes coincidieron.
    return (
      expected.length === derived.length && timingSafeEqual(expected, derived)
    );
  }

  /**
   * Devuelve el token de sesión, o null si las credenciales no sirven.
   *
   * Un correo que no existe y una contraseña incorrecta dan exactamente la
   * misma respuesta: distinguirlas permite averiguar qué correos son cuentas
   * válidas.
   */
  async login(email: string, password: string): Promise<string | null> {
    const user = await this.prisma.panelUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user || !user.active) {
      // Se gasta el mismo tiempo aunque el usuario no exista: si no, el
      // tiempo de respuesta delata qué correos están dados de alta.
      await this.hashPassword(password);
      return null;
    }

    if (!(await this.verifyPassword(password, user.passwordHash))) return null;

    const token = randomBytes(32).toString('base64url');

    await this.prisma.panelSession.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.panelUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return token;
  }

  /** Identidad detrás de un token, o null si no vale. */
  async resolve(token: string | null): Promise<PanelIdentity | null> {
    if (!token) return null;

    const session = await this.prisma.panelSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) return null;
    if (!session.user.active) return null;

    return identityOf(session.user);
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.prisma.panelSession.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  /** Alta de operadores. Por ahora la usa el script de línea de comandos. */
  async createUser(input: {
    email: string;
    name: string;
    password: string;
    role: PanelRole;
  }): Promise<PanelIdentity> {
    const user = await this.prisma.panelUser.create({
      data: {
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash: await this.hashPassword(input.password),
        role: input.role,
      },
    });

    return identityOf(user);
  }
}

/**
 * En la tabla se guarda el hash del token, no el token.
 *
 * SHA-256 sin sal a propósito, y no scrypt: el token son 32 bytes
 * aleatorios, no una contraseña que alguien pueda adivinar, así que no hay
 * nada que ralentizar — y esto corre en CADA petición del panel.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function identityOf(user: PanelUser): PanelIdentity {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
