/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE TEAM SOCIAL (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/team/team-social.service.ts
 * Camada de Defesa: C3 (RBAC) + C12 (Auditoria)
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { TeamSocialLink } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import type { ActorContext } from "@/lib/services/league/season.service";
import type {
  UpsertSocialLinkInput,
  RemoveSocialLinkInput,
} from "@/lib/security/utils/validations.roster";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

async function assertTeamExists(teamId: string) {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true },
  });
  if (!team) {
    throw new NotFoundError("Time não encontrado.");
  }
  return team;
}

// ============================================================================
// 1. UPSERT (Criar ou Atualizar)
// ============================================================================

/**
 * Adiciona ou atualiza uma rede social do time.
 * Operação idempotente por chave composta (teamId + platform).
 */
export async function upsertTeamSocialLink(
  teamId: string,
  input: UpsertSocialLinkInput,
  actor: ActorContext,
): Promise<TeamSocialLink> {
  const team = await assertTeamExists(teamId);

  // Busca existente para verificar idempotência e montar snapshot do AuditLog
  const existing = await db.teamSocialLink.findUnique({
    where: {
      teamId_platform: { teamId, platform: input.platform },
    },
  });

  // Idempotência: se a URL não mudou, retorna silenciosamente
  if (existing && existing.url === input.url) {
    return existing;
  }

  const upserted = await db.teamSocialLink.upsert({
    where: {
      teamId_platform: { teamId, platform: input.platform },
    },
    update: { url: input.url },
    create: {
      teamId,
      platform: input.platform,
      url: input.url,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_SOCIAL_UPSERT,
    entity: "TeamSocialLink",
    entityId: upserted.id,
    before: existing ? { url: existing.url } : null,
    after: { url: upserted.url, platform: upserted.platform },
    ip: actor.ip ?? null,
    metadata: { teamId, teamName: team.name },
  });

  return upserted;
}

// ============================================================================
// 2. REMOVE (Deletar)
// ============================================================================

/**
 * Remove uma rede social do time.
 * Idempotente: se já não existir, retorna silenciosamente.
 */
export async function removeTeamSocialLink(
  teamId: string,
  input: RemoveSocialLinkInput,
  actor: ActorContext,
): Promise<void> {
  const existing = await db.teamSocialLink.findUnique({
    where: {
      teamId_platform: { teamId, platform: input.platform },
    },
  });

  if (!existing) {
    return; // Já não existe, fluxo continua sem erro
  }

  await db.teamSocialLink.delete({
    where: { id: existing.id },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_SOCIAL_REMOVE,
    entity: "TeamSocialLink",
    entityId: existing.id,
    before: { url: existing.url, platform: existing.platform },
    after: null,
    ip: actor.ip ?? null,
    metadata: { teamId },
  });
}

// ============================================================================
// 3. READ (Público / Leitura)
// ============================================================================

/**
 * Lista todas as redes sociais vinculadas a um time.
 * Não utiliza paginação pois a lista é sempre pequena (limitada ao enum SocialPlatform).
 */
export async function listTeamSocialLinks(
  teamId: string,
): Promise<TeamSocialLink[]> {
  return db.teamSocialLink.findMany({
    where: { teamId },
    orderBy: { platform: "asc" },
  });
}
