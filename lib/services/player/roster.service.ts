/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE ROSTER SNAPSHOT (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/player/roster.service.ts
 * Camada de Defesa: C3 (RBAC) + C12 (Auditoria)
 *
 * RESPONSABILIDADE:
 * Gerar um "retrato" estático do elenco (RosterSnapshot) para um Split.
 * Resolve consultas históricas sem depender do log de transferências.
 *
 * INTEGRAÇÃO:
 * Na E3.3, o guard `requirePlayerInRoster` consumirá esses snapshots para
 * garantir que o SCOREKEEPER não lance pontos para jogador não inscrito.
 *
 * IDEMPOTÊNCIA:
 * Pode ser executado múltiplas vezes. A cada execução:
 *   1. Remove snapshots de jogadores sem contrato ativo no split (limpeza)
 *   2. Upsert por @@unique([splitId, playerId]) para os ativos (criação/atualização)
 * Resultado: o snapshot sempre reflete o estado ATUAL dos contratos.
 *
 * REGRAS:
 *   - Split DEVE estar ativo.
 *   - Apenas contratos de times ativos são incluídos.
 *   - Toda operação (limpeza + upserts + audit) é atômica.
 * ============================================================================
 */

import { db } from "@/lib/db";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  type ActorContext,
  LeagueConflictError,
} from "@/lib/services/league/season.service";
import { Prisma } from "@prisma/client";

/**
 * Gera (ou atualiza) o snapshot completo de elencos de um Split.
 *
 * Fluxo:
 *   1. Valida que o Split existe e está ativo
 *   2. Busca contratos ativos neste Split (apenas times ativos)
 *   3. Remove snapshots órfãos (jogadores sem contrato ativo)
 *   4. Upsert por jogador ativo
 *   5. AuditLog atômico
 */
export async function generateRosterSnapshot(
  splitId: string,
  actor: ActorContext,
) {
  // 1. Validação do Split
  const split = await db.split.findUnique({
    where: { id: splitId },
    select: { id: true, name: true, isActive: true },
  });

  if (!split) throw new NotFoundError("Split não encontrado.");

  if (!split.isActive) {
    throw new LeagueConflictError(
      "O split deve estar ativo para gerar o RosterSnapshot.",
      "SPLIT_NOT_ACTIVE",
    );
  }

  // 2. Busca contratos ativos neste Split (apenas times ativos)
  const activeContracts = await db.playerContract.findMany({
    where: {
      splitId,
      endDate: null,
      team: { isActive: true },
    },
    include: {
      player: { select: { id: true, position: true } },
    },
  });

  // 3. Transação atômica: limpeza + upserts + audit
  const result = await db.$transaction(async (tx) => {
    // 3a. IDs dos jogadores que DEVEM estar no snapshot
    const activePlayerIds = activeContracts.map((c) => c.playerId);

    // 3b. Remove snapshots órfãos (jogadores que não têm mais contrato ativo)
    const deleted = await tx.rosterSnapshot.deleteMany({
      where: {
        splitId,
        ...(activePlayerIds.length > 0
          ? { playerId: { notIn: activePlayerIds } }
          : {}),
      },
    });

    // 3c. Upsert para cada contrato ativo
    let upsertedCount = 0;

    for (const contract of activeContracts) {
      await tx.rosterSnapshot.upsert({
        where: {
          splitId_playerId: {
            splitId,
            playerId: contract.playerId,
          },
        },
        update: {
          teamId: contract.teamId,
          jerseyNumber: contract.jerseyNumber,
          position: contract.player.position,
        },
        create: {
          splitId,
          teamId: contract.teamId,
          playerId: contract.playerId,
          jerseyNumber: contract.jerseyNumber,
          position: contract.player.position,
        },
      });
      upsertedCount++;
    }

    // 3d. Auditoria atômica
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.ROSTER_SNAPSHOT_GENERATED,
        entity: "Split",
        entityId: splitId,
        before: Prisma.DbNull,
        after: {
          activeCount: upsertedCount,
          removedCount: deleted.count,
        },
        ip: actor.ip ?? null,
        metadata: {
          splitName: split.name,
        },
      },
    });

    return {
      activeCount: upsertedCount,
      removedCount: deleted.count,
    };
  });

  return result;
}
