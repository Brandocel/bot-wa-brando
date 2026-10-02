import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentLinkService } from '../../application/support/document-link.service';
import { EntregaVigenteService } from '../../application/support/entrega-vigente.service';
import {
  DOCUMENT_SOURCE_PORT,
  type DocumentSourcePort,
} from '../../application/ports/document-source.port';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Descarga por enlace firmado.
 *
 * Sin sesión a propósito: quien abre esto es el cliente desde WhatsApp, en
 * el navegador de su teléfono, y no tiene ni va a tener cuenta en el panel.
 * Lo que autoriza es la firma del enlace, que ya se emitió a alguien con
 * permiso comprobado y caduca en media hora. Y además, al abrirlo, que esa
 * persona TODAVÍA pueda ver el documento: retirarle el permiso apaga los
 * enlaces que ya tiene.
 *
 * El documento se sirve desde Drive en el momento, no se guarda copia: si
 * el permiso cambia o el archivo desaparece, el enlace deja de entregar.
 */
@Controller('d')
export class DownloadController {
  private readonly logger = new Logger(DownloadController.name);

  constructor(
    private readonly links: DocumentLinkService,
    private readonly entregas: EntregaVigenteService,
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_SOURCE_PORT) private readonly source: DocumentSourcePort,
  ) {}

  @Get(':token')
  async download(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const enlace = this.links.verificar(token);

    if (!enlace) {
      // Enlace caducado o manipulado: la misma respuesta para los dos casos.
      // Distinguirlos ayudaría a quien esté probando firmas.
      res.status(404).type('text/plain').send('Este enlace ya no es válido.');
      return;
    }

    const documento = await this.entregas.documento(enlace, enlace.documentId, 'descarga');

    if (!documento) {
      res.status(404).type('text/plain').send('Este documento ya no está disponible.');
      return;
    }

    try {
      const bytes = await this.source.download(documento.driveFileId);

      // Toda descarga queda registrada: con facturas de por medio, saber
      // quién bajó qué y cuándo deja de ser higiene y pasa a ser requisito.
      await this.prisma.accessAudit.create({
        data: {
          waId: enlace.waId,
          query: `descarga ${documento.name}`,
          documentId: documento.id,
          decision: 'ALLOW',
          decidedBy: 'enlace firmado vigente',
        },
      });

      res.setHeader('Content-Type', documento.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(documento.name)}"`,
      );
      res.send(bytes);
    } catch (err) {
      this.logger.error(`no se pudo servir ${documento.name}: ${String(err)}`);
      res.status(502).type('text/plain').send('No se pudo recuperar el archivo.');
    }
  }
}
