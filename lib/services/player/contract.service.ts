/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE CONTRATOS (Onda 3 - E3.2 Redesign)
 * ============================================================================
 * Arquivo: lib/services/player/contract.service.ts
 * Camada de Defesa: C3 (RBAC) + C4 (ABAC) + C6 (Workflow) + C12 (Auditoria)
 *
 * INVARIANTE DE DOMÍNIO:
 * Um jogador possui no máximo 1 contrato ativo (endDate IS NULL) por Split.
 * Jogadores podem ter contratos simultâneos em Splits diferentes.
 *
 * ATOMICIDADE:
 * Toda mutação (create, transfer, close) roda em $transaction.
 * Toda auditoria usa tx.auditLog.create() DENTRO da transação.
 * Se a transação falha, dados E logs revertem juntos.
 *
 * REGRAS DE STATUS:
 *   - createInitialContract: FREE_AGENT → ACTIVE
 *   - transferPlayer: mantém ACTIVE
 *   - closeContract(RETIRED): fecha TODOS os contratos, status → RETIRED
 *   - closeContract(RELEASED): fecha 1 contrato, status → FREE_AGENT
 *     apenas se não houver outros contratos ativos em outros Splits
 *   - closeContract(INJURED_LONG): fecha 1 contrato, status → INJURED
 * ============================================================================
 */

import { db } from "@/lib/db";
import { Prisma, PlayerStatus, type PlayerContract } from "@prisma/client";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import type { ActorContext } from "@/lib/services/league/season.service";
import { generateContractCode } from "@/lib/services/player/contract-code";

// ============================================================================
// CLASSES DE ERRO E TIPOS
// ============================================================================

export class ContractConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code: string;

  constructor(message: string, code = "CONTRACT_CONFLICT") {
    super(message);
    this.name = "ContractConflictError";
    this.code = code;
  }
}

export interface CreateInitialContractInput {
  teamId: string;
  splitId: string;
  jerseyNumber: number;
  startDate: string;
}

export interface TransferPlayerInput {
  newTeamId: string;
  splitId: string;
  jerseyNumber: number;
  startDate: string;
  transferFee?: number;
}

export type CloseContractReason = "RETIRED" | "RELEASED" | "INJURED_LONG";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

async function assertTeamActive(teamId: string) {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, shortName: true, isActive: true },
  });
  if (!team) throw new NotFoundError("Time não encontrado.");
  if (!team.isActive) {
    throw new ContractConflictError(`O time "${team.name}" está inativo.`);
  }
  return team;
}

async function assertJerseyNumberAvailable(
  tx: Prisma.TransactionClient,
  teamId: string,
  jerseyNumber: number,
) {
  const conflict = await tx.playerContract.findFirst({
    where: { teamId, jerseyNumber, endDate: null },
    select: { id: true },
  });

  if (conflict) {
    throw new ContractConflictError(
      `O número ${jerseyNumber} já está em uso por outro jogador ativo neste time.`,
    );
  }
}

/**
 * Gera código de contrato com retry para colisão de entropia.
 * Máximo 3 tentativas antes de abortar.
 */
async function generateUniqueContractCode(
  tx: Prisma.TransactionClient,
  input: {
    teamShortName: string | null;
    teamName: string;
    playerFirstName: string;
    playerLastName: string;
    jerseyNumber: number;
    seasonShortCode: string;
  },
): Promise<string> {
  let attempts = 0;
  while (attempts < 3) {
    const code = generateContractCode(input);
    const existing = await tx.playerContract.findUnique({
      where: { contractCode: code },
    });
    if (!existing) return code;
    attempts++;
  }
  throw new ContractConflictError(
    "Falha interna ao gerar código único de contrato. Tente novamente.",
  );
}

// ============================================================================
// 1. CREATE INITIAL CONTRACT
// ============================================================================

/**
 * Cria o primeiro contrato (ou novo contrato após período sem clube)
 * dentro de um Split específico.
 *
 * Bloqueia se o jogador já possuir contrato ativo NESTE Split.
 * Contratos em outros Splits não interferem.
 */
export async function createInitialContract(
  playerId: string,
  input: CreateInitialContractInput,
  actor: ActorContext,
): Promise<PlayerContract> {
  const player = await db.player.findUnique({ where: { id: playerId } });
  if (!player) throw new NotFoundError("Jogador não encontrado.");

  if (player.status === PlayerStatus.RETIRED) {
    throw new ContractConflictError(
      "Não é possível assinar contrato com um jogador aposentado.",
    );
  }

  const team = await assertTeamActive(input.teamId);
  const split = await db.split.findUnique({
    where: { id: input.splitId },
    include: { season: { select: { shortCode: true } } },
  });

  if (!split) throw new NotFoundError("Split não encontrado.");

  const createdContract = await db.$transaction(async (tx) => {
    // 1. Invariante por Split: já possui contrato ativo neste torneio?
    const existingActive = await tx.playerContract.findFirst({
      where: { playerId, splitId: input.splitId, endDate: null },
    });

    if (existingActive) {
      throw new ContractConflictError(
        "O jogador já possui um contrato ativo neste Split. Utilize a operação de Transferência.",
      );
    }

    // 2. Camisa disponível no time (escopo global)
    await assertJerseyNumberAvailable(tx, input.teamId, input.jerseyNumber);

    // 3. Código legível único
    const contractCode = await generateUniqueContractCode(tx, {
      teamShortName: team.shortName,
      teamName: team.name,
      playerFirstName: player.firstName,
      playerLastName: player.lastName,
      jerseyNumber: input.jerseyNumber,
      seasonShortCode: split.season.shortCode,
    });

    // 4. Cria o contrato
    const contract = await tx.playerContract.create({
      data: {
        contractCode,
        playerId,
        teamId: input.teamId,
        splitId: input.splitId,
        jerseyNumber: input.jerseyNumber,
        startDate: new Date(input.startDate),
        endDate: null,
      },
    });

    // 5. Promove para ACTIVE se estava FREE_AGENT
    if (player.status === PlayerStatus.FREE_AGENT) {
      await tx.player.update({
        where: { id: playerId },
        data: { status: PlayerStatus.ACTIVE },
      });
    }

    // 6. Auditoria atômica (tx.auditLog.create)
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.CONTRACT_CREATE,
        entity: "PlayerContract",
        entityId: contract.id,
        before: Prisma.DbNull,
        after: {
          contractCode,
          playerId,
          teamId: input.teamId,
          splitId: input.splitId,
          jerseyNumber: input.jerseyNumber,
          startDate: contract.startDate.toISOString(),
        },
        ip: actor.ip ?? null,
      },
    });

    return contract;
  });

  return createdContract;
}

// ============================================================================
// 2. TRANSFER PLAYER (ATÔMICO — MESMO SPLIT)
// ============================================================================

/**
 * Transfere o jogador de um time para outro dentro do MESMO Split.
 * Fecha o contrato anterior e abre novo atomicamente.
 */
export async function transferPlayer(
  playerId: string,
  input: TransferPlayerInput,
  actor: ActorContext,
): Promise<PlayerContract> {
  const player = await db.player.findUnique({ where: { id: playerId } });
  if (!player) throw new NotFoundError("Jogador não encontrado.");

  if (player.status === PlayerStatus.RETIRED) {
    throw new ContractConflictError(
      "Não é possível transferir um jogador aposentado.",
    );
  }

  const newTeam = await assertTeamActive(input.newTeamId);
  const split = await db.split.findUnique({
    where: { id: input.splitId },
    include: { season: { select: { shortCode: true } } },
  });

  if (!split) throw new NotFoundError("Split não encontrado.");

  const newContract = await db.$transaction(async (tx) => {
    // 1. Contrato atual no mesmo Split
    const currentContract = await tx.playerContract.findFirst({
      where: { playerId, splitId: input.splitId, endDate: null },
    });

    if (!currentContract) {
      throw new NotFoundError(
        "Nenhum contrato ativo encontrado para este jogador neste Split.",
      );
    }

    if (currentContract.teamId === input.newTeamId) {
      throw new ContractConflictError(
        "O jogador já está atrelado ativamente a este time.",
      );
    }

    // 2. Camisa disponível no novo time
    await assertJerseyNumberAvailable(tx, input.newTeamId, input.jerseyNumber);

    // 3. Encerra o contrato anterior
    const now = new Date();
    const closedContract = await tx.playerContract.update({
      where: { id: currentContract.id },
      data: { endDate: now },
    });

    // 4. Novo código legível
    const contractCode = await generateUniqueContractCode(tx, {
      teamShortName: newTeam.shortName,
      teamName: newTeam.name,
      playerFirstName: player.firstName,
      playerLastName: player.lastName,
      jerseyNumber: input.jerseyNumber,
      seasonShortCode: split.season.shortCode,
    });

    // 5. Cria o novo contrato
    const created = await tx.playerContract.create({
      data: {
        contractCode,
        playerId,
        teamId: input.newTeamId,
        splitId: input.splitId,
        jerseyNumber: input.jerseyNumber,
        startDate: new Date(input.startDate),
        endDate: null,
        transferFee: input.transferFee ?? null,
      },
    });

    // 6. Garante ACTIVE
    if (player.status !== PlayerStatus.ACTIVE) {
      await tx.player.update({
        where: { id: playerId },
        data: { status: PlayerStatus.ACTIVE },
      });
    }

    // 7. Auditoria atômica (3 eventos)
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.CONTRACT_CLOSE,
        entity: "PlayerContract",
        entityId: closedContract.id,
        before: { endDate: null },
        after: { endDate: now.toISOString() },
        ip: actor.ip ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.CONTRACT_CREATE,
        entity: "PlayerContract",
        entityId: created.id,
        before: Prisma.DbNull,
        after: {
          contractCode,
          playerId,
          teamId: created.teamId,
          splitId: created.splitId,
          jerseyNumber: created.jerseyNumber,
          startDate: created.startDate.toISOString(),
        },
        ip: actor.ip ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.PLAYER_TRANSFER,
        entity: "Player",
        entityId: playerId,
        before: {
          teamId: closedContract.teamId,
          jerseyNumber: closedContract.jerseyNumber,
        },
        after: {
          teamId: created.teamId,
          jerseyNumber: created.jerseyNumber,
        },
        ip: actor.ip ?? null,
        metadata: {
          oldContractId: closedContract.id,
          newContractId: created.id,
          splitId: input.splitId,
          transferFee: input.transferFee,
        },
      },
    });

    return created;
  });

  return newContract;
}

// ============================================================================
// 3. CLOSE CONTRACT (Encerramento Avulso)
// ============================================================================

/**
 * Encerra um contrato sem abrir novo (dispensa, aposentadoria ou lesão).
 *
 * REGRAS DE SINCRONIZAÇÃO DE STATUS (multi-split):
 *   RETIRED  → Fecha TODOS os contratos ativos do jogador (todos os Splits).
 *              Status → RETIRED (terminal).
 *   RELEASED → Fecha apenas ESTE contrato.
 *              Status → FREE_AGENT somente se não houver outros contratos ativos.
 *              Status → mantém ACTIVE se houver contratos em outros Splits.
 *   INJURED_LONG → Fecha apenas ESTE contrato.
 *              Status → INJURED.
 */
export async function closeContract(
  contractId: string,
  reason: CloseContractReason,
  actor: ActorContext,
): Promise<PlayerContract> {
  const currentContract = await db.playerContract.findUnique({
    where: { id: contractId },
    include: { player: { select: { id: true, status: true } } },
  });

  if (!currentContract) throw new NotFoundError("Contrato não encontrado.");
  if (currentContract.endDate !== null) {
    throw new ContractConflictError("Este contrato já está encerrado.");
  }

  const closedContract = await db.$transaction(async (tx) => {
    const now = new Date();

    // 1. Encerra o contrato alvo
    const updated = await tx.playerContract.update({
      where: { id: contractId },
      data: { endDate: now, notes: `Encerrado motivo: ${reason}` },
    });

    // 2. Se RETIRED: fecha TODOS os outros contratos ativos
    if (reason === "RETIRED") {
      const otherActive = await tx.playerContract.findMany({
        where: {
          playerId: currentContract.playerId,
          endDate: null,
          NOT: { id: contractId },
        },
      });

      for (const contract of otherActive) {
        await tx.playerContract.update({
          where: { id: contract.id },
          data: {
            endDate: now,
            notes: "Fechamento automático por aposentadoria do jogador.",
          },
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
              reason: "Fechamento automático por aposentadoria.",
              splitId: contract.splitId,
            },
          },
        });
      }
    }

    // 3. Determina novo status do jogador
    let newStatus = currentContract.player.status;

    if (reason === "RETIRED") {
      newStatus = PlayerStatus.RETIRED;
    } else if (reason === "RELEASED") {
      // Verifica se há outros contratos ativos em outros Splits
      const remainingActive = await tx.playerContract.count({
        where: {
          playerId: currentContract.playerId,
          endDate: null,
          NOT: { id: contractId },
        },
      });

      newStatus =
        remainingActive > 0 ? PlayerStatus.ACTIVE : PlayerStatus.FREE_AGENT;
    } else if (reason === "INJURED_LONG") {
      newStatus = PlayerStatus.INJURED;
    }

    // 4. Atualiza status se mudou
    if (newStatus !== currentContract.player.status) {
      await tx.player.update({
        where: { id: currentContract.playerId },
        data: { status: newStatus },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: AUDIT_EVENTS.PLAYER_STATUS_CHANGE,
          entity: "Player",
          entityId: currentContract.playerId,
          before: { status: currentContract.player.status },
          after: { status: newStatus },
          ip: actor.ip ?? null,
          metadata: { reason: `Contrato encerrado. Motivo: ${reason}` },
        },
      });
    }

    // 5. Audit do contrato principal
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.CONTRACT_CLOSE,
        entity: "PlayerContract",
        entityId: contractId,
        before: { endDate: null },
        after: { endDate: now.toISOString() },
        ip: actor.ip ?? null,
        metadata: { reason },
      },
    });

    return updated;
  });

  return closedContract;
}

// ============================================================================
// 4. READ (Consultas)
// ============================================================================

/**
 * Contrato ativo do jogador em um Split específico.
 * Usado em: validação de elenco (E3.3), check-in (E3.3.5).
 */
export async function getCurrentContract(playerId: string, splitId: string) {
  return db.playerContract.findFirst({
    where: { playerId, splitId, endDate: null },
    include: {
      team: { select: { id: true, name: true, slug: true, logoUrl: true } },
      split: { select: { id: true, name: true } },
    },
  });
}

/**
 * Todos os contratos ativos do jogador (todos os Splits).
 * Usado em: painel admin, aposentadoria, visão geral.
 */
export async function getAllActiveContracts(playerId: string) {
  return db.playerContract.findMany({
    where: { playerId, endDate: null },
    include: {
      team: { select: { id: true, name: true, slug: true, logoUrl: true } },
      split: { select: { id: true, name: true } },
    },
  });
}

/**
 * Histórico completo de contratos do jogador (todos os Splits, ativos e encerrados).
 * Usado em: perfil do jogador, timeline de carreira.
 */
export async function getContractHistory(playerId: string) {
  return db.playerContract.findMany({
    where: { playerId },
    orderBy: { startDate: "desc" },
    include: {
      team: { select: { id: true, name: true, slug: true, logoUrl: true } },
      split: { select: { id: true, name: true } },
    },
  });
}
