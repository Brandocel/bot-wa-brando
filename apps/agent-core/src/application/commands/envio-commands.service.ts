import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import type { IncomingMessage } from '../../domain/message/incoming-message';

/**
 * Diagnóstico de por qué no salen los archivos, desde WhatsApp.
 *
 * El gateway ya expone estos datos por HTTP, pero pedirlos exige una llave
 * de despliegue y una terminal. Quien necesita la respuesta está en el
 * teléfono, mirando el chat donde el envío falló. Aquí la tiene.
 *
 * Son comandos del DUEÑO: mandan mensajes de prueba a números reales y
 * enseñan identificadores de contactos, así que no son para cualquiera.
 */

interface Variante {
  candidato: string;
  existeEnWhatsApp: boolean | null;
  idCanonico: string | null;
  chatExiste: boolean;
  error: string | null;
}

interface Diagnostico {
  entrada: string;
  digitos: string | null;
  variantes: Variante[];
  chatOriginal: Record<string, unknown> | null;
  chatsQueCoinciden: string[];
}

interface PasoPrueba {
  paso: string;
  ok: boolean;
  detalle: string;
}

@Injectable()
export class EnvioCommandsService {
  private async pedir<T>(
    path: string,
    init?: { method: 'POST'; body: unknown },
  ): Promise<T> {
    const res = await fetch(`${config.gatewayUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'x-gateway-key': config.gatewayApiKey,
        ...(init ? { 'content-type': 'application/json' } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`gateway respondió ${res.status}: ${detalle}`);
    }

    return (await res.json()) as T;
  }

  /**
   * `/diag` — sin argumentos, diagnostica ESTE chat, que es el que falla.
   *
   * Con un argumento se puede diagnosticar otro destino, pero lo normal es
   * escribirlo desde el chat que dio problemas y no tener que copiar ids a
   * mano: el id de un chat con LID no se puede teclear de memoria.
   */
  async diagnosticar(args: string, message: IncomingMessage): Promise<string> {
    const destino = args.trim() || message.chatId;

    let d: Diagnostico;
    try {
      d = await this.pedir<Diagnostico>(
        `/diag/destino?to=${encodeURIComponent(destino)}`,
      );
    } catch (err) {
      return `No pude diagnosticar ${destino}: ${String(err)}`;
    }

    const lineas = [`Diagnóstico de ${d.entrada}`, ''];

    if (!d.digitos) {
      lineas.push(
        'No se pudo sacar el número de teléfono de este chat.',
        'Sin número no hay a dónde mandar el archivo, y eso ya explica el fallo.',
      );
    } else {
      lineas.push(`Teléfono detectado: ${d.digitos}`, '');
    }

    for (const v of d.variantes) {
      // "chat existe" es LA pregunta: open-wa rechaza la media si no hay un
      // chat guardado con ese id, aunque el número exista de sobra.
      lineas.push(
        `${v.chatExiste ? '✓' : '✗'} ${v.candidato}`,
        `   en WhatsApp: ${v.existeEnWhatsApp === null ? 'no se pudo comprobar' : v.existeEnWhatsApp ? 'sí' : 'no'}`,
        `   id canónico: ${v.idCanonico ?? '—'}`,
        `   chat guardado: ${v.chatExiste ? 'sí' : 'NO'}`,
      );
      if (v.error) lineas.push(`   error: ${v.error}`);
      lineas.push('');
    }

    if (d.chatsQueCoinciden.length > 0) {
      lineas.push('Chats abiertos con ese número:', ...d.chatsQueCoinciden.map((c) => `• ${c}`), '');
    }

    if (d.chatOriginal) {
      lineas.push('Del chat original:');
      for (const [clave, valor] of Object.entries(d.chatOriginal)) {
        lineas.push(`• ${clave}: ${String(valor)}`);
      }
      lineas.push('');
    }

    const bueno = d.variantes.find((v) => v.chatExiste);
    lineas.push(
      bueno
        ? `Prueba a mandar el archivo por ahí:\n/probar ${bueno.candidato}`
        : 'Ningún destino tiene chat guardado. Prueba igual con:\n' +
            d.variantes.map((v) => `/probar ${v.candidato}`).join('\n'),
    );

    return lineas.join('\n');
  }

  /**
   * `/probar <destino>` — texto primero y archivo después, al MISMO id.
   *
   * Es la secuencia que open-wa pide literalmente en su error. El destino va
   * explícito a propósito: esto manda mensajes de verdad y nadie debería
   * recibir una prueba porque el comando adivinó mal.
   */
  async probar(args: string): Promise<string> {
    const destino = args.trim();

    if (!destino) {
      return [
        'Uso: /probar <destino>',
        '',
        'Corre /diag primero: te dice qué destinos probar.',
        'Ojo: esto manda un mensaje y un PDF de prueba de verdad.',
      ].join('\n');
    }

    let pasos: PasoPrueba[];
    try {
      const res = await this.pedir<{ pasos: PasoPrueba[] }>('/diag/enviar', {
        method: 'POST',
        body: { to: destino },
      });
      pasos = res.pasos;
    } catch (err) {
      return `No se pudo probar ${destino}: ${String(err)}`;
    }

    return [
      `Prueba con ${destino}`,
      '',
      ...pasos.map((p) => `${p.ok ? '✓' : '✗'} ${p.paso}\n   ${p.detalle}`),
    ].join('\n');
  }
}
