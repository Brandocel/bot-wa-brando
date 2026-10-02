import { Injectable } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { AccessScopeService } from './access-scope.service';
import { DocumentLinkService } from './document-link.service';
import { DocumentSearchService } from './document-search.service';

/**
 * ¿Esta persona TODAVÍA puede recibir este documento?
 *
 * El permiso se decide al buscar, pero el archivo sale después: el outbox
 * lo manda segundos (o, con el gateway caído, minutos) más tarde, y el
 * enlace de respaldo se abre cuando la persona quiera. Si en medio se le
 * quitó la membresía, el permiso o la verificación, o el documento se
 * excluyó, lo autorizado ya no vale. Aquí se vuelve a preguntar justo
 * antes de mandar y antes de servir una descarga.
 */
@Injectable()
export class EntregaVigenteService {
  constructor(
    private readonly scope: AccessScopeService,
    private readonly search: DocumentSearchService,
    private readonly links: DocumentLinkService,
  ) {}

  /** El documento si sigue dentro de su alcance; null si ya no. */
  async documento(
    destino: { waId: string; chatId: string },
    documentId: string,
    momento: 'envio' | 'respaldo' | 'descarga',
  ): Promise<Document | null> {
    const alcance = await this.scope.resolve(destino.waId, destino.chatId);
    const doc = await this.search.byId(documentId, alcance.scopes);

    if (!doc) {
      await this.scope.audit({
        waId: destino.waId,
        query: `revalidación al ${momento}`,
        documentId,
        decision: 'DENY_REVOKED',
        decidedBy: `permiso o documento retirado antes del ${momento}`,
      });
    }
    return doc;
  }

  /**
   * El texto con el enlace de respaldo. Se crea al rendirse con el adjunto,
   * no al encolarlo: si el gateway estuvo caído media hora, un enlace hecho
   * al principio llegaba vencido.
   */
  textoDeRespaldo(doc: Document, destino: { waId: string; chatId: string }): string {
    const enlace = this.links.crear(doc.id, destino);
    return [
      `No pude adjuntarte ${doc.name} por aquí, pero lo descargas desde:`,
      enlace.url,
      '',
      'El enlace vence en 30 minutos.',
    ].join('\n');
  }
}
