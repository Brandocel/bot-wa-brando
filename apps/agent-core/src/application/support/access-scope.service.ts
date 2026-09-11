import { Injectable } from '@nestjs/common';
import type { DocCategory } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * LA frontera de seguridad del módulo de soporte.
 *
 * Resuelve, contra el número de WhatsApp y NADA más, qué documentos puede ver
 * quien escribe. Corre antes de cualquier búsqueda y antes de cualquier prompt.
 * El LLM jamás participa en esta decisión: para cuando el modelo ve algo, el
 * conjunto de documentos ya viene recortado y no hay texto que lo agrande.
 *
 * Deny por defecto: sin membresía vigente y sin grant aplicable, no hay acceso.
 */

/** Categorías que exigen un número verificado. Fiscal y legal, básicamente. */
const SENSITIVE: readonly DocCategory[] = ['FACTURA', 'CONTRATO', 'POLIZA'];

export type AccessDecision =
  | 'ALLOW'
  | 'DENY_NO_MEMBERSHIP'
  | 'DENY_UNVERIFIED'
  | 'DENY_NO_GRANT'
  | 'DENY_PERIOD';

/** Una categoría permitida, con su ventana de periodo (null = sin límite). */
export interface CategoryWindow {
  category: DocCategory;
  periodFrom: Date | null;
  periodTo: Date | null;
}

export interface OrgScope {
  organizationId: string;
  organizationName: string;
  windows: CategoryWindow[];
  /**
   * Categorías que el grant SÍ otorga pero que se cayeron por falta de
   * verificación del número. Sin esto, negar una factura a un número no
   * verificado quedaría auditado como "sin permiso", que es una causa
   * distinta y lleva a la corrección equivocada.
   */
  strippedByVerification: DocCategory[];
}

export interface ScopeResult {
  decision: AccessDecision;
  /** Nombre de la regla que decidió. Va tal cual a AccessAudit. */
  decidedBy: string;
  scopes: OrgScope[];
}

@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toda decisión de acceso queda escrita, permitida o no. Es lo que el
   * panel enseña como "entregas" y "negados", y lo único que explica
   * después por qué a alguien se le contestó "no encontré".
   *
   * Falla en silencio a propósito: perder una línea de auditoría es malo,
   * pero tumbar la respuesta por no poder escribirla es peor.
   */
  async audit(input: {
    waId: string;
    query: string;
    documentId: string | null;
    decision: string;
    decidedBy: string;
  }): Promise<void> {
    try {
      await this.prisma.accessAudit.create({ data: input });
    } catch {
      // Sin log: quien llama está en medio de contestarle a una persona.
    }
  }

  /**
   * Alcance completo de un número. El resultado es lo ÚNICO que entra al WHERE
   * de la búsqueda: nadie más abajo vuelve a ver el waId, así que no se puede
   * escribir por accidente una consulta que se olvide de filtrar.
   */
  async resolve(waId: string): Promise<ScopeResult> {
    const now = new Date();

    const memberships = await this.prisma.membership.findMany({
      where: {
        contact: { waId },
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        organization: { active: true },
      },
      include: {
        organization: { select: { id: true, name: true } },
        grants: { where: { revokedAt: null } },
      },
    });

    if (memberships.length === 0) {
      return {
        decision: 'DENY_NO_MEMBERSHIP',
        decidedBy: 'sin membresía vigente',
        scopes: [],
      };
    }

    const scopes: OrgScope[] = [];
    let blockedByVerification = false;

    for (const membership of memberships) {
      const verified = membership.verifiedAt !== null;

      // MANAGER y ADMIN ven todas las categorías de su organización sin
      // ventana de periodo. VIEWER solo lo que un grant vigente le dé.
      const windows: CategoryWindow[] =
        membership.role === 'VIEWER'
          ? membership.grants.map((grant) => ({
              category: grant.category,
              periodFrom: grant.periodFrom,
              periodTo: grant.periodTo,
            }))
          : ALL_CATEGORIES.map((category) => ({
              category,
              periodFrom: null,
              periodTo: null,
            }));

      // Un número sin verificar conserva su membresía, pero pierde todo lo
      // sensible. Se marca la razón para poder distinguirla de "sin grant".
      const allowed = verified
        ? windows
        : windows.filter((w) => !SENSITIVE.includes(w.category));

      const stripped = windows
        .filter((w) => !allowed.includes(w))
        .map((w) => w.category);

      if (stripped.length > 0) blockedByVerification = true;
      if (allowed.length === 0) continue;

      scopes.push({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        windows: allowed,
        strippedByVerification: stripped,
      });
    }

    if (scopes.length === 0) {
      return blockedByVerification
        ? {
            decision: 'DENY_UNVERIFIED',
            decidedBy: 'número no verificado para documentos sensibles',
            scopes: [],
          }
        : {
            decision: 'DENY_NO_GRANT',
            decidedBy: 'membresía sin permisos otorgados',
            scopes: [],
          };
    }

    return { decision: 'ALLOW', decidedBy: 'membresía vigente', scopes };
  }

  /**
   * Por qué se le negaría ESTA consulta concreta a un alcance ya resuelto.
   * Devuelve null si la consulta cabe dentro del alcance.
   *
   * Solo alimenta la auditoría y las notas internas del escalamiento. Al
   * usuario nunca se le dice "no tienes permiso": se le dice "no lo encontré".
   * Distinguir ambos casos permite mapear el Drive ajeno a base de preguntas.
   */
  denialFor(
    scopes: readonly OrgScope[],
    category: DocCategory,
    period: Date | null,
  ): AccessDecision | null {
    const withCategory = scopes.flatMap((scope) =>
      scope.windows.filter((w) => w.category === category),
    );

    if (withCategory.length === 0) {
      // Verificación primero: es la causa más específica y la única que el
      // operador puede resolver dando de alta al número.
      const unverified = scopes.some((scope) =>
        scope.strippedByVerification.includes(category),
      );
      return unverified ? 'DENY_UNVERIFIED' : 'DENY_NO_GRANT';
    }
    if (!period) return null;

    const inWindow = withCategory.some(
      (w) =>
        (!w.periodFrom || period >= w.periodFrom) &&
        (!w.periodTo || period <= w.periodTo),
    );

    return inWindow ? null : 'DENY_PERIOD';
  }
}

const ALL_CATEGORIES: readonly DocCategory[] = [
  'FACTURA',
  'CONTRATO',
  'COTIZACION',
  'REPORTE',
  'POLIZA',
  'OTRO',
];
