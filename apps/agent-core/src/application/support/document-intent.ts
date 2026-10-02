import type { SlotPendiente } from './solicitud.service';
import { normalizar } from './message-classifier';
import { nombreDeArchivo, parseQuery } from './query-parser';

export type DocumentIntent =
  | { kind: 'document'; request: string }
  | { kind: 'ambiguous' }
  | { kind: 'other' };

/**
 * Esta decisión precede a SearchQuery. Un tipo, mes, empresa o texto suelto
 * describe datos posibles, pero no demuestra que se esté pidiendo un archivo.
 * Las expresiones regulares de aquí reconocen actos de pedir y respuestas al
 * estado; no intentan enumerar todas las formas de charla humana.
 */
export function documentIntent(
  raw: string,
  context: { enCurso: boolean; pendiente: SlotPendiente | null; companyName: string | null },
): DocumentIntent {
  const text = raw.trim();
  const clean = normalizar(text);
  if (!clean) return { kind: 'other' };

  // Una petición al final de un mensaje mixto es el único tramo que puede
  // proporcionar palabras clave. Conservamos el original (acentos y nombres).
  const requestVerb = /\b(?:necesito|necesitamos|quiero|queremos|quisiera|quisi[eé]ramos|ocupo|ocupamos|busco|buscamos|d[aá]me|m[aá]ndame|p[aá]same|env[ií]ame|comp[aá]rteme|mu[eé]strame|cons[ií]gueme|busca(?:me)?|me\s+(?:pasas|mandas|env[ií]as|das|buscas|compartes|(?:puedes|podr[ií]as|ayudas|har[ií]as)\s+(?:a\s+)?(?:mandar|pasar|enviar|buscar|dar|conseguir|hacer\s+llegar))|(?:puedo|c[oó]mo)\s+(?:obtener|descargar|buscar))\b/gi;
  const matches = [...text.matchAll(requestVerb)];
  let sawAmbiguousRequest = false;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const request = text.slice(match.index, matches[i + 1]?.index).trim();
    const suffix = request.slice(match[0].length).trim();
    const objectPhrase = normalizar(suffix)
      .replace(/^(?:(?:por favor|porfa|primero|ahora si|ahora|ya|nada mas|solo)\s+)*/g, '');
    const target = objectPhrase
      .replace(/^(?:(?:el|la|los|las|un|una|unos|unas|mi|mis|su|sus|este|esta|estos|estas|otro|otra|otros|otras|todo|toda|todos|todas)\s+)*/, '');
    const words = target.split(' ');
    const categoryHead = /^(?:estados?|reporte|reportes)$/.test(words[0] ?? '')
      ? words.slice(0, 3).join(' ')
      : words[0] ?? '';
    const directObject = !!parseQuery(categoryHead).category ||
      /^(?:documentos?|docs?|archivo|pdf|papel|copia|folio)\b/.test(target) ||
      /^(?:[a-z]{1,3}-?\d{3,}[a-z0-9-]*)\b/.test(target);
    const indirectObject = /^(?:lo|la|las|los|todas|todos)\s+(?:de|del|en)\s+\S+/.test(objectPhrase) ||
      /^(?:lo|la|las|los|todas|todos)$/.test(objectPhrase);
    if (!directObject && !indirectObject) {
      if (/^(?:eso|esa|ese|aquello)$/.test(target) ||
          /^(?:[a-zñ]{4,12}|20\d{2})$/.test(target) && parseQuery(target).period) {
        sawAmbiguousRequest = true;
      }
      continue;
    }
    const query = parseQuery(request);
    const genericDocument = /\b(?:documentos?|docs?|archivo|pdf|papel|copia)\b/i.test(normalizar(request));
    if (directObject && (query.category || query.folio || nombreDeArchivo(request) || genericDocument)) {
      return { kind: 'document', request };
    }
    if (indirectObject) {
      if (query.period && !context.enCurso) return { kind: 'ambiguous' };
      return { kind: 'document', request }; // Claude interpreta el objeto
    }
    if (/\b(?:eso|esa|ese|aquello)\b/.test(normalizar(request))) sawAmbiguousRequest = true;
  }
  if (sawAmbiguousRequest) return { kind: 'ambiguous' };

  const query = parseQuery(text);
  const short = clean.split(' ').length <= 5 && !/[.!?;:]/.test(text);
  const correction = /\bno\s+era\s+\w+\s*,?\s*era\s+\w+\b/.test(clean);

  if (context.enCurso || context.pendiente) {
    if (correction && (query.category || query.period)) return { kind: 'document', request: text };
    if (short && query.category && /^(?:no|mejor)\s+(?:(?:el|la|un|una)\s+)?[a-zñ]+(?:\s+de\s+cuenta)?$/.test(clean)) {
      return { kind: 'document', request: text };
    }
    const monthAnswer = /^(?:(?:no|mejor|y|ahora)\s+)?(?:(?:la|el|lo)\s+de(?:l)?\s+|de\s+|del\s+|mes\s+de\s+)?(?:[a-zñ]{4,12}|20\d{2}[-/]\d{1,2})(?:\s+(?:de\s+)?20\d{2})?$/.test(clean) ||
      /^(?:(?:la|el)\s+de\s+)?(?:este mes|mes pasado|mes anterior|mes actual)$/.test(clean);
    const folioAnswer = /^(?:(?:no|mejor|y)\s+)?(?:(?:la|el|lo)\s+)?(?:(?:de|del)\s+)?(?:folio\s+)?[a-z]{1,3}-?\d{3,}[a-z0-9-]*$/.test(clean);
    const fileAnswer = nombreDeArchivo(text) !== null &&
      /^(?:(?:el|la|archivo|documento|nombre|de|del)\s+)*\S+$/.test(text);
    if (short && ((query.period && monthAnswer) || (query.folio && folioAnswer) || fileAnswer)) {
      return { kind: 'document', request: text };
    }
    if (context.pendiente === 'categoria' && short && query.category &&
        /^(?:(?:no|mejor)\s+)?(?:(?:el|la|un|una)\s+)?[a-zñ]+(?:\s+de\s+cuenta)?$/.test(clean)) {
      return { kind: 'document', request: text };
    }
    const companyAnswer = clean.replace(/^de\s+/, '');
    if (context.pendiente === 'empresa' && context.companyName && short &&
        oneEditApart(companyAnswer, normalizar(context.companyName))) {
      return { kind: 'document', request: text };
    }
    if (context.pendiente === 'detalle' && short && /^[A-ZÁÉÍÓÚÑ][\p{L}\p{N}_-]*(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}\p{N}_-]*)?$/u.test(text)) {
      return { kind: 'document', request: text };
    }
    if (short && /^(?:(?:y|ahora|mejor)\s+)?(?:la|el|lo|las|los)\s+de\s+\S+/.test(clean)) {
      return { kind: 'document', request: text };
    }
  }

  // Un sintagma nominal completo funciona como pedido breve por WhatsApp:
  // “la factura de marzo”. Una oración sobre el documento no lo es.
  const noun = /^(?:(?:y|ahora|mejor)\s+)?(?:(?:la|el|las|los|mi|mis|una|un)\s+)?(\S+(?:\s+de\s+cuenta)?)(.*)$/i.exec(text);
  if (noun && parseQuery(noun[1]!).category && query.category) {
    const tail = normalizar(noun[2] ?? '');
    if (tail && /^(?:de|del|con|para|en|a|al)\b/.test(tail) &&
        tail.split(' ').length <= 6 &&
        !/\b(?:es|son|esta|estan|estuvo|estaba|fue|fueron|vencio|perdio|haciendo|hizo|salio|costo|cobro)\b/.test(tail)) {
      return { kind: 'document', request: text };
    }
    if (!tail) return { kind: 'ambiguous' };
  }

  if (correction && query.category) return { kind: 'document', request: text };
  if (/^(?:que|cuales|cual|cuantas|cuantos)\b/.test(clean) && query.category &&
      /\b(?:tienes|tienen|hay|existen|disponibles)\b/.test(clean)) {
    return { kind: 'document', request: text };
  }
  if (short && query.period && /^(?:de|del|la de|el de)\b/.test(clean)) return { kind: 'ambiguous' };

  // "¿Tienes el doc de Pollo Pirata?", "¿hay facturas de marzo?": preguntar
  // si existe un documento ES pedirlo. Solo con un sustantivo de documento
  // justo después: "¿tienes hambre?" no cuenta.
  const existe = /^(?:oye\s+)?(?:y\s+)?(?:me\s+)?(?:tienes|tienen|tendras|tendran|hay|habra|existe|existen)\s+(?:(?:el|la|los|las|un|una|unos|unas|algun|alguna|algunos|algunas|mi|mis)\s+)?(\S+(?:\s+de\s+cuenta)?)/.exec(clean);
  if (existe && (/^(?:documentos?|docs?|archivos?|pdfs?|papeles|copias?)$/.test(existe[1]!) || parseQuery(existe[1]!).category)) {
    return { kind: 'document', request: text };
  }

  // Referencias deícticas sin una solicitud vigente no tienen objeto seguro.
  if (/^(?:(?:y|ahora)\s+)?(?:lo|la|el)\s+de\s+\S+|^(?:esa|ese|eso|la anterior|el anterior)$/.test(clean)) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'other' };
}

/** Una errata en la respuesta a “¿de qué empresa?”, sin aceptar una oración. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
