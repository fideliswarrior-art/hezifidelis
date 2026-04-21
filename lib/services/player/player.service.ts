/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE PLAYER (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/player/player.service.ts
 * Camada de Defesa: C3 (RBAC) + C6 (State Machine) + C12 (Auditoria) + C13 (LGPD)
 *
 * REGRAS CRÍTICAS:
 *   1. Jogador nasce com status FREE_AGENT (sem contrato = sem time).
 *      O createInitialContract promove para ACTIVE.
 *   2. Aposentadoria fecha TODOS os contratos ativos (multi-split).
 *   3. AuditLog de operações transacionais usa tx.auditLog.create()
 *      diretamente para garantir atomicidade (§0.4 da Finalização).
 *   4. LGPD Art. 8º: menores sem parentalConsentId não aparecem
 *      em endpoints públicos (retorna null → 404 na rota).
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { Prisma, Player, Position } from "@prisma/client";
import { PlayerStatus } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { sanitizePlainText } from "@/lib/security/content/sanitize";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  type ActorContext,
  LeagueConflictError,
} from "@/lib/services/league/season.service";
import type {
  CreatePlayerInput,
  UpdatePlayerInput,
  UpdatePlayerStatusInput,
} from "@/lib/security/utils/validations.roster";
import { validateTransition } from "@/lib/security/guards/require-status-transition";
import {
  generatePlayerCode,
  hashForAudit,
  generateTicketQrImage,
} from "@/lib/security/crypto/qrcode";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

function playerSnapshot(p: Player) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    slug: p.slug,
    status: p.status,
    position: p.position,
  };
}

async function assertSlugAvailable(
  slug: string,
  excludeId?: string,
): Promise<void> {
  const existing = await db.player.findUnique({
    where: { slug },
    select: { id: true, firstName: true, lastName: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new LeagueConflictError(
      `Já existe um jogador usando o slug "${slug}" (${existing.firstName} ${existing.lastName}).`,
      "SLUG_ALREADY_EXISTS",
    );
  }
}

/** LGPD Art. 8º: Calcula se o jogador é menor de 18 anos. */
function isMinor(dateOfBirth: Date | null): boolean {
  if (!dateOfBirth) return false;
  const ageDifMs = Date.now() - dateOfBirth.getTime();
  const ageDate = new Date(ageDifMs);
  return Math.abs(ageDate.getUTCFullYear() - 1970) < 18;
}

// ============================================================================
// 1. CREATE
// ============================================================================

export async function createPlayer(
  input: CreatePlayerInput,
  actor: ActorContext,
): Promise<Player> {
  await assertSlugAvailable(input.slug);

  const data: Prisma.PlayerUncheckedCreateInput = {
    firstName: input.firstName,
    lastName: input.lastName,
    slug: input.slug,
    position: input.position,
    status: PlayerStatus.FREE_AGENT, // ★ DT-002: Jogador sem contrato = FREE_AGENT
  };

  if (input.nickname !== undefined) data.nickname = input.nickname;
  if (input.photoUrl !== undefined) data.photoUrl = input.photoUrl;
  if (input.nationality !== undefined) data.nationality = input.nationality;
  if (input.dateOfBirth !== undefined)
    data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
  if (input.heightCm !== undefined) data.heightCm = input.heightCm;
  if (input.weightKg !== undefined) data.weightKg = input.weightKg;
  if (input.userId !== undefined) data.userId = input.userId;

  if (input.bio !== undefined) {
    data.bio = input.bio ? sanitizePlainText(input.bio, 2000) : null;
  }

  const created = await db.player.create({ data });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_CREATE,
    entity: "Player",
    entityId: created.id,
    before: null,
    after: playerSnapshot(created),
    ip: actor.ip ?? null,
  });

  return created;
}

// ============================================================================
// 2. UPDATE (Metadados básicos)
// ============================================================================

export async function updatePlayer(
  id: string,
  patch: UpdatePlayerInput,
  actor: ActorContext,
): Promise<Player> {
  const current = await db.player.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Jogador não encontrado.");

  if (patch.slug !== undefined && patch.slug !== current.slug) {
    await assertSlugAvailable(patch.slug, id);
  }

  const data: Prisma.PlayerUncheckedUpdateInput = {};

  if (patch.firstName !== undefined) data.firstName = patch.firstName;
  if (patch.lastName !== undefined) data.lastName = patch.lastName;
  if (patch.nickname !== undefined) data.nickname = patch.nickname;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.photoUrl !== undefined) data.photoUrl = patch.photoUrl;
  if (patch.nationality !== undefined) data.nationality = patch.nationality;
  if (patch.dateOfBirth !== undefined)
    data.dateOfBirth = patch.dateOfBirth ? new Date(patch.dateOfBirth) : null;
  if (patch.position !== undefined) data.position = patch.position;
  if (patch.heightCm !== undefined) data.heightCm = patch.heightCm;
  if (patch.weightKg !== undefined) data.weightKg = patch.weightKg;
  if (patch.userId !== undefined) data.userId = patch.userId;

  if (patch.bio !== undefined) {
    data.bio = patch.bio ? sanitizePlainText(patch.bio, 2000) : null;
  }

  const updated = await db.player.update({ where: { id }, data });

  const warnings: string[] = [];
  if (patch.slug !== undefined && patch.slug !== current.slug) {
    warnings.push("Slug alterado. URLs antigas irão quebrar.");
  }

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_UPDATE,
    entity: "Player",
    entityId: id,
    before: playerSnapshot(current),
    after: playerSnapshot(updated),
    ip: actor.ip ?? null,
    metadata: warnings.length > 0 ? { warnings } : undefined,
  });

  return updated;
}

// ============================================================================
// 3. UPDATE STATUS (Máquina de Estado + Aposentadoria Multi-Split)
// ============================================================================

/**
 * Atualiza o status do jogador com validação de state machine.
 *
 * APOSENTADORIA: Fecha TODOS os contratos ativos (um por Split)
 * atomicamente. Com contratos por Split, um jogador pode ter N
 * contratos simultâneos — todos devem ser encerrados.
 *
 * ATOMICIDADE: Toda operação (status + contratos + auditoria)
 * roda dentro de uma única $transaction via tx.auditLog.create().
 */
export async function updatePlayerStatus(
  id: string,
  input: UpdatePlayerStatusInput,
  actor: ActorContext,
): Promise<Player> {
  const current = await db.player.findUnique({
    where: { id },
    include: { contracts: { where: { endDate: null } } },
  });

  if (!current) throw new NotFoundError("Jogador não encontrado.");
  if (current.status === input.status) return current;

  // 1. Valida a transição contra a PlayerStatusMachine
  validateTransition("Player", current.status, input.status);

  // 2. Transação atômica: status + contratos + auditoria
  const updated = await db.$transaction(async (tx) => {
    const updatedPlayer = await tx.player.update({
      where: { id },
      data: { status: input.status },
    });

    // Aposentadoria: fecha TODOS os contratos ativos (multi-split)
    if (input.status === PlayerStatus.RETIRED && current.contracts.length > 0) {
      const now = new Date();

      for (const contract of current.contracts) {
        await tx.playerContract.update({
          where: { id: contract.id },
          data: { endDate: now },
        });

        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: AUDIT_EVENTS.CONTRACT_CLOSE,
            entity: "PlayerContract",
            entityId: contract.id,
            before: { endDate: null },
            after: { endDate: now.toISOString() },
            ip: actor.ip ?? null,
            metadata: {
              reason: "Fechamento automático por aposentadoria do jogador.",
              splitId: contract.splitId,
            },
          },
        });
      }
    }

    // AuditLog do status dentro da mesma transação
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.PLAYER_STATUS_CHANGE,
        entity: "Player",
        entityId: id,
        before: { status: current.status },
        after: { status: updatedPlayer.status },
        ip: actor.ip ?? null,
        metadata: {
          reason: input.reason,
          contractsClosed: current.contracts.length,
        },
      },
    });

    return updatedPlayer;
  });

  return updated;
}

// ============================================================================
// 4. READ (Admin & Público com LGPD)
// ============================================================================

/**
 * Retorna visão completa do Admin (sem filtros de privacidade).
 */
export async function getPlayerById(id: string) {
  return db.player.findUnique({
    where: { id },
    include: {
      socialLinks: true,
      contracts: {
        orderBy: { startDate: "desc" },
        include: {
          team: { select: { id: true, name: true, slug: true, logoUrl: true } },
          split: { select: { id: true, name: true } },
        },
      },
      splitStats: { include: { split: { select: { id: true, name: true } } } },
      seasonStats: {
        include: { season: { select: { id: true, name: true } } },
      },
      awards: true,
    },
  });
}

/**
 * Retorna visão Pública.
 *
 * LGPD Art. 8º (Menores):
 *   - Se dateOfBirth indica menor de 18 E não possui parentalConsentId
 *     → retorna null (a rota interpreta como 404 genérico, não vazando
 *     existência do jogador menor sem consentimento).
 *   - Se menor COM consentimento → mascara dateOfBirth, expõe perfil.
 *   - Se maior de 18 → retorna tudo normalmente.
 */
export async function getPlayerBySlug(slug: string) {
  const player = await db.player.findUnique({
    where: { slug },
    include: {
      socialLinks: true,
      contracts: {
        where: { endDate: null },
        include: {
          team: { select: { id: true, name: true, slug: true, logoUrl: true } },
          split: { select: { id: true, name: true } },
        },
      },
      splitStats: { include: { split: { select: { id: true, name: true } } } },
    },
  });

  if (!player) return null;

  // LGPD Art. 8º: Menores sem consentimento parental não aparecem publicamente
  if (isMinor(player.dateOfBirth)) {
    if (!player.parentalConsentId) {
      return null; // 404 genérico na rota — não vaza existência
    }

    // Menor COM consentimento: mascara dateOfBirth, expõe perfil
    const { dateOfBirth, ...safePlayer } = player;
    return { ...safePlayer, ageGroup: "SUB_18" as const };
  }

  return player;
}

export interface ListPlayersQuery {
  status?: PlayerStatus;
  position?: Position;
  teamId?: string;
  take: number;
  cursor?: string;
}

export async function listPlayers(query: ListPlayersQuery) {
  const { status, position, teamId, take, cursor } = query;

  const where: Prisma.PlayerWhereInput = {
    ...(status !== undefined && { status }),
    ...(position !== undefined && { position }),
    ...(teamId !== undefined && {
      contracts: { some: { teamId, endDate: null } },
    }),
  };

  const items = await db.player.findMany({
    where,
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: [{ status: "asc" }, { firstName: "asc" }],
    include: {
      contracts: {
        where: { endDate: null },
        select: {
          team: { select: { name: true, slug: true, logoUrl: true } },
          split: { select: { id: true, name: true } },
          jerseyNumber: true,
        },
      },
    },
  });

  let nextCursor: string | undefined;
  if (items.length > take) {
    const last = items.pop();
    nextCursor = last?.id;
  }

  return { items, nextCursor };
}

// ============================================================================
// 5. DELETE (Hard Delete - SUPER_ADMIN)
// ============================================================================

export async function deletePlayer(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.player.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          contracts: true,
          matchStats: true,
          draftPicks: true,
          awards: true,
          matchEvents: true,
        },
      },
    },
  });

  if (!current) throw new NotFoundError("Jogador não encontrado.");

  const counts = current._count;
  const totalDependents =
    counts.contracts +
    counts.matchStats +
    counts.draftPicks +
    counts.awards +
    counts.matchEvents;

  if (totalDependents > 0) {
    throw new LeagueConflictError(
      `O jogador possui ${totalDependents} registro(s) vinculado(s) (contratos, estatísticas, lances, prêmios ou draft). Para preservar a integridade histórica, aposente o jogador ou anonimize a conta (LGPD) em vez de deletar.`,
      "PLAYER_HAS_HISTORY",
    );
  }

  const { _count, ...currentBase } = current;
  await db.player.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_DELETE,
    entity: "Player",
    entityId: id,
    before: playerSnapshot(currentBase),
    after: null,
    ip: actor.ip ?? null,
  });
}

// ============================================================================
// 6. GERAR QR CODE DE CHECK-IN (E3.5)
// ============================================================================

/**
 * Gera (ou regenera) o QR Code permanente de check-in do jogador.
 *
 * Apenas ADMIN+ pode executar. Regenerar sobrescreve o QR anterior
 * (o antigo para de funcionar imediatamente).
 *
 * Retorna a imagem Data URL para exibição/impressão no painel admin.
 */
export async function generatePlayerQrCode(
  playerId: string,
  actor: ActorContext,
): Promise<{ qrImage: string; generatedAt: Date }> {
  const player = await db.player.findUnique({
    where: { id: playerId },
    select: { id: true, firstName: true, lastName: true, checkInQrCode: true },
  });

  if (!player) throw new NotFoundError("Jogador não encontrado.");

  const { code, auditHash } = generatePlayerCode();
  const now = new Date();

  await db.player.update({
    where: { id: playerId },
    data: {
      checkInQrCode: code,
      checkInQrGeneratedAt: now,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_QR_GENERATE,
    entity: "Player",
    entityId: playerId,
    before: player.checkInQrCode
      ? { qrCodeHash: hashForAudit(player.checkInQrCode) }
      : null,
    after: { qrCodeHash: auditHash },
    ip: actor.ip ?? null,
    metadata: {
      isRegeneration: !!player.checkInQrCode,
      playerName: `${player.firstName} ${player.lastName}`,
    },
  });

  const qrImage = await generateTicketQrImage(code);

  return { qrImage, generatedAt: now };
}
