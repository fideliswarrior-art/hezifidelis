import { db } from "@/lib/db";
import { ConsentPurpose } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError, ConsentError } from "@/lib/security/utils/errors"; // DT-10: Erros centralizados

/**
 * ============================================================================
 * MÓDULO: Serviço de Consentimento LGPD (Onda 2 - E2.6)
 * ============================================================================
 * * OBJETIVO:
 * Gerenciar a concessão, revogação e consulta de consentimentos granulares
 * dos usuários (Art. 7º e 8º da LGPD).
 * * * DECISÕES DE ARQUITETURA:
 * 1. Upsert Atômico: Garante que só exista 1 registro por (userId, purpose).
 * 2. Revogação Segura: O consentimento ESSENTIAL nunca pode ser revogado,
 * pois é a base legal (execução de contrato) para a conta existir.
 * 3. Auditoria Imutável: Cada mudança gera um log forense com IP e versão da política.
 * ============================================================================
 */

/**
 * Concede ou re-concede um consentimento para uma finalidade específica.
 */
export async function grantConsent(
  userId: string,
  purpose: ConsentPurpose,
  policyVersion: string,
  ipAddress?: string,
  userAgent?: string,
) {
  // 1. Busca o estado anterior para fins de auditoria (before/after)
  const previous = await db.consent.findUnique({
    where: { userId_purpose: { userId, purpose } },
  });

  // 2. Upsert: Cria se não existir, atualiza se já existir
  const consent = await db.consent.upsert({
    where: { userId_purpose: { userId, purpose } },
    update: {
      granted: true,
      grantedAt: new Date(),
      revokedAt: null, // Limpa a data de revogação caso esteja re-concedendo
      policyVersion,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
    create: {
      userId,
      purpose,
      granted: true,
      policyVersion,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });

  // 3. Auditoria Forense (DT-11: Removido 'as any')
  await createAuditLog({
    userId,
    action: AUDIT_EVENTS.CONSENT_GRANT,
    entity: "Consent",
    entityId: consent.id,
    before: previous
      ? { granted: previous.granted, policyVersion: previous.policyVersion }
      : null,
    after: { granted: true, policyVersion },
    ip: ipAddress ?? null,
    metadata: { purpose },
  });

  return consent;
}

/**
 * Revoga um consentimento previamente concedido.
 */
export async function revokeConsent(
  userId: string,
  purpose: ConsentPurpose,
  ipAddress?: string,
) {
  // 1. Regra de Negócio: Não se revoga o que é essencial para o sistema rodar
  if (purpose === ConsentPurpose.ESSENTIAL) {
    throw new ConsentError(
      "O consentimento ESSENTIAL não pode ser revogado. Para isso, a conta deve ser excluída.",
      "CANNOT_REVOKE_ESSENTIAL",
    );
  }

  const existing = await db.consent.findUnique({
    where: { userId_purpose: { userId, purpose } },
  });

  if (!existing) {
    throw new NotFoundError(
      "Consentimento não encontrado para este usuário e finalidade.",
    );
  }

  // Se já está revogado, retornamos silenciosamente (Idempotência)
  if (!existing.granted) {
    return existing;
  }

  // 2. Atualiza o status
  const updated = await db.consent.update({
    where: { id: existing.id },
    data: {
      granted: false,
      revokedAt: new Date(),
    },
  });

  // 3. Auditoria Forense (DT-11: Removido 'as any')
  await createAuditLog({
    userId,
    action: AUDIT_EVENTS.CONSENT_REVOKE,
    entity: "Consent",
    entityId: updated.id,
    before: { granted: true },
    after: { granted: false },
    ip: ipAddress ?? null,
    metadata: { purpose },
  });

  // NOTA ARQUITETURAL: Se 'purpose' tinha efeito em dados distribuídos (ex: PHOTO_EVENTS),
  // o ideal aqui é disparar um Job em background para remover/borrar as fotos do usuário.

  return updated;
}

/**
 * Verifica rapidamente se um usuário possui um consentimento ativo.
 * Muito útil para Guards em rotas sensíveis.
 */
export async function hasConsent(
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> {
  const consent = await db.consent.findUnique({
    where: { userId_purpose: { userId, purpose } },
    select: { granted: true },
  });

  return consent?.granted === true;
}

/**
 * Lista todos os consentimentos de um usuário para exibição no painel de privacidade.
 */
export async function listConsents(userId: string) {
  return await db.consent.findMany({
    where: { userId },
    orderBy: { purpose: "asc" },
  });
}
