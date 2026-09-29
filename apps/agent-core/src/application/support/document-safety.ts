/**
 * Reglas duras de lo que nunca sale por WhatsApp.
 *
 * Van antes que cualquier clasificación y ninguna la puede contradecir: ni
 * el modelo, ni el nombre, ni un operador aprobando desde el panel. Un
 * cliente que elige el Escritorio entero como carpeta del conector sube
 * credenciales.txt junto a sus cotizaciones, y eso no puede acabar siendo
 * un documento que el bot ofrece.
 *
 * Son reglas y no el modelo a propósito: son baratas, deterministas, y lo
 * que detectan no se le manda a nadie para que opine.
 */

/** Separadores de palabra en una ruta: "api_key", "mis-contraseñas.txt". */
const SEP = '[\\/_\\-. ]';

/**
 * Palabras que delatan un archivo de credenciales, estén donde estén de la
 * ruta. Van con separadores a los lados: "secretaria" no es "secret", y
 * "tokens" sí es "token".
 */
const PALABRAS_SENSIBLES = new RegExp(
  `(^|${SEP})(credencial(es)?|contrase(n|ñ)as?|passwords?|passwd|secrets?|tokens?|` +
    `api${SEP}?keys?|private${SEP}?keys?|id_(rsa|dsa|ecdsa|ed25519)|csr|ssl)(?=${SEP}|$)`,
  'i',
);

/** Archivos de configuración con secretos y formatos de llaves y certificados. */
const ARCHIVOS_SENSIBLES =
  /((^|\/)\.env(\.[^/]*)?$|\.(pem|key|pfx|p12|crt|cer|csr|kdbx|ppk|ovpn|jks|keystore)$)/i;

/** ¿La ruta (carpetas incluidas) dice que es un archivo de credenciales? */
export function esSensible(path: string): boolean {
  const ruta = path.normalize('NFC');
  return PALABRAS_SENSIBLES.test(ruta) || ARCHIVOS_SENSIBLES.test(ruta);
}

/**
 * Lo que delata un secreto DENTRO del texto: llaves privadas, solicitudes
 * de certificado, "password: ...", llaves de API con su prefijo conocido,
 * cadenas de conexión con usuario y contraseña.
 *
 * Se mira el texto ya normalizado (minúsculas, sin acentos). Un documento
 * que dispara esto no se guarda ni se le manda al modelo.
 */
const CONTENIDO_SENSIBLE: readonly RegExp[] = [
  /-----begin [a-z ]*(private key|certificate request)/,
  /\b(password|passwd|pwd|contrasena|api[_ -]?key|secret[_ -]?key|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*\S{4,}/,
  /\bakia[0-9a-z]{16}\b/, // AWS
  /\bsk-(ant-)?[0-9a-z_-]{20,}/, // Anthropic / OpenAI
  /\bgh[pousr]_[0-9a-z]{30,}/, // GitHub
  /\bxox[abprs]-[0-9a-z-]{10,}/, // Slack
  /\baiza[0-9a-z_-]{35}\b/, // Google
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s]+/, // postgres://usuario:clave@host
];

export function contenidoSensible(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return CONTENIDO_SENSIBLE.some((patron) => patron.test(texto));
}
