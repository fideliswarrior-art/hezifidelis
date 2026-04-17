/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE PLAYER SOCIAL (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/player/player-social.service.ts
 * Camada de Defesa: C3 (RBAC) + C12 (Auditoria)
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { PlayerSocialLink } from "@prisma/client";
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

async function assertPlayerExists(playerId: string) {
  const player = await db.player.findUnique({
    where: { id: playerId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!player) {
    throw new NotFoundError("Jogador não encontrado.");
  }
  return player;
}

// ============================================================================
// 1. UPSERT (Criar ou Atualizar)
// ============================================================================

/**
 * Adiciona ou atualiza uma rede social do jogador.
 * Operação idempotente por chave composta (playerId + platform).
 */
export async function upsertPlayerSocialLink(
  playerId: string,
  input: UpsertSocialLinkInput,
  actor: ActorContext,
): Promise<PlayerSocialLink> {
  const player = await assertPlayerExists(playerId);

  // Busca existente para verificar idempotência e montar snapshot do AuditLog
  const existing = await db.playerSocialLink.findUnique({
    where: {
      playerId_platform: { playerId, platform: input.platform },
    },
  });

  // Idempotência: se a URL não mudou, retorna silenciosamente
  if (existing && existing.url === input.url) {
    return existing;
  }

  const upserted = await db.playerSocialLink.upsert({
    where: {
      playerId_platform: { playerId, platform: input.platform },
    },
    update: { url: input.url },
    create: {
      playerId,
      platform: input.platform,
      url: input.url,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_SOCIAL_UPSERT,
    entity: "PlayerSocialLink",
    entityId: upserted.id,
    before: existing ? { url: existing.url } : null,
    after: { url: upserted.url, platform: upserted.platform },
    ip: actor.ip ?? null,
    metadata: {
      playerId,
      playerName: `${player.firstName} ${player.lastName}`,
    },
  });

  return upserted;
}

// ============================================================================
// 2. REMOVE (Deletar)
// ============================================================================

/**
 * Remove uma rede social do jogador.
 * Idempotente: se já não existir, retorna silenciosamente.
 */
export async function removePlayerSocialLink(
  playerId: string,
  input: RemoveSocialLinkInput,
  actor: ActorContext,
): Promise<void> {
  const existing = await db.playerSocialLink.findUnique({
    where: {
      playerId_platform: { playerId, platform: input.platform },
    },
  });

  if (!existing) {
    return; // Já não existe, fluxo continua sem erro
  }

  await db.playerSocialLink.delete({
    where: { id: existing.id },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_SOCIAL_REMOVE,
    entity: "PlayerSocialLink",
    entityId: existing.id,
    before: { url: existing.url, platform: existing.platform },
    after: null,
    ip: actor.ip ?? null,
    metadata: { playerId },
  });
}

// ============================================================================
// 3. READ (Público / Leitura)
// ============================================================================

/**
 * Lista todas as redes sociais vinculadas a um jogador.
 * Não utiliza paginação pois a lista é sempre pequena (limitada ao enum SocialPlatform).
 */
export async function listPlayerSocialLinks(
  playerId: string,
): Promise<PlayerSocialLink[]> {
  return db.playerSocialLink.findMany({
    where: { playerId },
    orderBy: { platform: "asc" },
  });
}
