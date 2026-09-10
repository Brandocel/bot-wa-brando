import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocCategory, MemberRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import {
  InvalidPhoneError,
  normalizePhone,
} from '../../domain/contact/phone';
import {
  MESSAGING_PORT,
  type MessagingPort,
} from '../ports/messaging.port';

/**
 * Alta y baja del directorio: empresas, números y qué puede ver cada uno.
 *
 * Aquí se toca la frontera de seguridad del sistema, así que cada operación
 * deja rastro de quién la hizo. Un permiso sin autor es un permiso que nadie
 * puede explicar tres meses después.
 *
 * El número se normaliza Y se verifica contra WhatsApp. Lo primero acierta
 * casi siempre; lo segundo convierte ese "casi" en certeza. Y "casi" en un
 * sistema de permisos significa que de vez en cuando alguien con acceso
 * recibe un "no encontré" que nadie sabe explicar.
 */

export interface AddMemberInput {
  organizationId: string;
  /** Lo que tecleó el operador: "9984862017", "+52 998...", lo que sea. */
  phone: string;
  displayName?: string;
  role: MemberRole;
  /** Categorías que podrá consultar. Vacío para MANAGER y ADMIN: ven todo. */
  categories?: DocCategory[];
  /** Quién autoriza. Va a la auditoría. */
  grantedBy: string;
}

export interface AddMemberResult {
  waId: string;
  display: string;
  /** false = WhatsApp dice que ese número no tiene cuenta. */
  existsOnWhatsApp: boolean;
  /** true = no se pudo preguntar a WhatsApp; se guardó con el formato deducido. */
  unverified: boolean;
}

@Injectable()
export class DirectoryService {
  private readonly logger = new Logger(DirectoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
  ) {}

  /**
   * Resuelve el identificador definitivo de un número.
   *
   * Primero la heurística, luego WhatsApp. Si el gateway no responde se
   * devuelve la heurística marcada como sin verificar: bloquear el alta
   * porque WhatsApp está caído sería peor, y el operador puede corregir.
   */
  async resolveWaId(phone: string): Promise<{
    waId: string;
    display: string;
    exists: boolean;
    unverified: boolean;
  }> {
    const normalized = normalizePhone(phone);

    try {
      const check = await this.messaging.checkNumber(normalized.waId);

      return {
        // El id que devuelve WhatsApp gana SIEMPRE sobre el nuestro.
        waId: check.waId ?? normalized.waId,
        display: normalized.display,
        exists: check.exists,
        unverified: false,
      };
    } catch (err) {
      this.logger.warn(
        `no se pudo verificar ${normalized.waId} contra WhatsApp: ${String(err)}`,
      );

      return {
        waId: normalized.waId,
        display: normalized.display,
        exists: false,
        unverified: true,
      };
    }
  }

  async addMember(input: AddMemberInput): Promise<AddMemberResult> {
    const resolved = await this.resolveWaId(input.phone);

    const contact = await this.prisma.contact.upsert({
      where: { waId: resolved.waId },
      create: {
        waId: resolved.waId,
        displayName: input.displayName ?? null,
      },
      update: input.displayName ? { displayName: input.displayName } : {},
    });

    const membership = await this.prisma.membership.upsert({
      where: {
        contactId_organizationId: {
          contactId: contact.id,
          organizationId: input.organizationId,
        },
      },
      create: {
        contactId: contact.id,
        organizationId: input.organizationId,
        role: input.role,
      },
      // Reactivar una membresía revocada es una operación normal: alguien
      // vuelve a la empresa. Se limpia la revocación en vez de crear otra.
      update: { role: input.role, revokedAt: null },
    });

    // VIEWER necesita permisos explícitos; MANAGER y ADMIN ven todo lo de su
    // organización y darles grants sería ruido que confunde al leer el panel.
    if (input.role === 'VIEWER') {
      for (const category of input.categories ?? []) {
        await this.prisma.accessGrant.upsert({
          where: {
            membershipId_category: {
              membershipId: membership.id,
              category,
            },
          },
          create: {
            membershipId: membership.id,
            category,
            grantedBy: input.grantedBy,
          },
          update: { revokedAt: null, grantedBy: input.grantedBy },
        });
      }
    }

    return {
      waId: resolved.waId,
      display: resolved.display,
      existsOnWhatsApp: resolved.exists,
      unverified: resolved.unverified,
    };
  }

  /**
   * Marca el número como verificado: a partir de aquí puede recibir
   * documentos sensibles. Es una decisión humana a propósito — un número de
   * WhatsApp se reasigna, se clona y se pierde con el teléfono.
   */
  async verifyMember(membershipId: string): Promise<void> {
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { verifiedAt: new Date() },
    });
  }

  /**
   * Revocar no borra: marca. La auditoría de ayer tiene que seguir siendo
   * legible, y para eso la membresía debe seguir existiendo.
   */
  async revokeMember(membershipId: string): Promise<void> {
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { revokedAt: new Date() },
    });
  }

  async setGrant(input: {
    membershipId: string;
    category: DocCategory;
    enabled: boolean;
    grantedBy: string;
  }): Promise<void> {
    if (!input.enabled) {
      await this.prisma.accessGrant.updateMany({
        where: { membershipId: input.membershipId, category: input.category },
        data: { revokedAt: new Date() },
      });
      return;
    }

    await this.prisma.accessGrant.upsert({
      where: {
        membershipId_category: {
          membershipId: input.membershipId,
          category: input.category,
        },
      },
      create: {
        membershipId: input.membershipId,
        category: input.category,
        grantedBy: input.grantedBy,
      },
      update: { revokedAt: null, grantedBy: input.grantedBy },
    });
  }

  async addOrganization(input: {
    name: string;
    driveFolderId: string;
    taxId?: string;
  }): Promise<{ id: string; name: string }> {
    const organization = await this.prisma.organization.create({
      data: {
        name: input.name.trim(),
        driveFolderId: input.driveFolderId.trim(),
        taxId: input.taxId?.trim() || null,
      },
    });

    return { id: organization.id, name: organization.name };
  }

  /** Vista previa para el formulario: qué se guardaría, sin guardar nada. */
  async preview(phone: string): Promise<{
    waId: string;
    display: string;
    exists: boolean;
    unverified: boolean;
    error?: string;
  }> {
    try {
      return await this.resolveWaId(phone);
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        return {
          waId: '',
          display: '',
          exists: false,
          unverified: true,
          error: err.message,
        };
      }
      throw err;
    }
  }
}
