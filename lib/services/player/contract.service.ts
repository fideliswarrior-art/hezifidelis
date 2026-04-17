/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE CONTRATOS (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/player/contract.service.ts
 * Camada de Defesa: C3 (RBAC) + C4 (ABAC) + C6 (Workflow) + C12 (Auditoria)
 * * RESPONSABILIDADE:
 * Gerenciar o ciclo de vida dos contratos de jogadores. A regra de ouro
 * deste domínio é a INVARIANTE DE ATOMICIDADE: Um jogador pode ter no
 * máximo 1 (um) contrato ativo simultaneamente (onde endDate IS NULL).
 * * Todas as operações de transferência ou fechamento são envelopadas em
 * transações atômicas para prevenir a geração de contratos duplicados em
 * casos de concorrência.
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { Prisma, PlayerContract } from "@prisma/client";
import { PlayerStatus } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import type { ActorContext } from "@/lib/services/league/season.service";

// ============================================================================
// CLASSES DE ERRO
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

// ============================================================================
// TIPOS DE ENTRADA (Mapeados do validations.roster.ts)
// ============================================================================

export interface CreateInitialContractInput {
  teamId: string;
  jerseyNumber: number;
  startDate: string; // ISO 8601
}

export interface TransferPlayerInput {
  newTeamId: string;
  jerseyNumber: number;
  startDate: string; // ISO 8601
  transferFee?: number;
}

export type CloseContractReason = "RETIRED" | "RELEASED" | "INJURED_LONG";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

async function assertTeamActive(teamId: string) {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, isActive: true },
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
    where: {
      teamId,
      jerseyNumber,
      endDate: null,
    },
    select: { id: true },
  });

  if (conflict) {
    throw new ContractConflictError(
      `O número ${jerseyNumber} já está em uso por outro jogador ativo neste time.`,
    );
  }
}

// ============================================================================
// 1. CREATE INITIAL CONTRACT
// ============================================================================

/**
 * Cria o primeiro contrato (ou novo contrato após um período sem clube).
 * Bloqueia se o jogador já possuir um contrato ativo.
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

  await assertTeamActive(input.teamId);

  const createdContract = await db.$transaction(async (tx) => {
    // 1. Verifica invariante: O jogador já possui contrato ativo?
    const existingActive = await tx.playerContract.findFirst({
      where: { playerId, endDate: null },
    });

    if (existingActive) {
      throw new ContractConflictError(
        "O jogador já possui um contrato ativo. Utilize a operação de Transferência.",
      );
    }

    // 2. Verifica disponibilidade do número da camisa no time destino
    await assertJerseyNumberAvailable(tx, input.teamId, input.jerseyNumber);

    // 3. Cria o novo contrato
    const contract = await tx.playerContract.create({
      data: {
        playerId,
        teamId: input.teamId,
        jerseyNumber: input.jerseyNumber,
        startDate: new Date(input.startDate),
        endDate: null, // Contrato Ativo
      },
    });

    // 4. Atualiza o status do jogador (caso estivesse como FREE_AGENT)
    if (player.status === PlayerStatus.FREE_AGENT) {
      await tx.player.update({
        where: { id: playerId },
        data: { status: PlayerStatus.ACTIVE },
      });
    }

    return contract;
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.CONTRACT_CREATE,
    entity: "PlayerContract",
    entityId: createdContract.id,
    before: null,
    after: {
      playerId,
      teamId: input.teamId,
      jerseyNumber: input.jerseyNumber,
      startDate: createdContract.startDate.toISOString(),
    },
    ip: actor.ip ?? null,
  });

  return createdContract;
}

// ============================================================================
// 2. TRANSFER PLAYER (A OPERAÇÃO MAIS CRÍTICA E ATÔMICA)
// ============================================================================

/**
 * Transfere o jogador de um time para outro.
 * Fecha o contrato anterior (endDate = now) e abre o novo atomicamente.
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

  await assertTeamActive(input.newTeamId);

  const result = await db.$transaction(async (tx) => {
    // 1. Identifica e bloqueia o contrato atual para update
    const currentContract = await tx.playerContract.findFirst({
      where: { playerId, endDate: null },
    });

    if (!currentContract) {
      throw new NotFoundError(
        "Nenhum contrato ativo encontrado para este jogador. Utilize a operação de Criação de Contrato Inicial.",
      );
    }

    if (currentContract.teamId === input.newTeamId) {
      throw new ContractConflictError(
        "O jogador já está atrelado ativamente a este time.",
      );
    }

    // 2. Verifica a disponibilidade do número da camisa no novo time
    await assertJerseyNumberAvailable(tx, input.newTeamId, input.jerseyNumber);

    // 3. Encerra o contrato anterior
    const closedContract = await tx.playerContract.update({
      where: { id: currentContract.id },
      data: { endDate: new Date() },
    });

    // 4. Cria o novo contrato
    const newContract = await tx.playerContract.create({
      data: {
        playerId,
        teamId: input.newTeamId,
        jerseyNumber: input.jerseyNumber,
        startDate: new Date(input.startDate),
        endDate: null,
        transferFee: input.transferFee ?? null,
      },
    });

    // 5. Garante que o status seja ACTIVE
    if (player.status !== PlayerStatus.ACTIVE) {
      await tx.player.update({
        where: { id: playerId },
        data: { status: PlayerStatus.ACTIVE },
      });
    }

    return { oldContract: closedContract, newContract };
  });

  // Dispara múltiplos eventos de auditoria após a transação
  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.CONTRACT_CLOSE,
    entity: "PlayerContract",
    entityId: result.oldContract.id,
    before: { endDate: null },
    after: { endDate: result.oldContract.endDate?.toISOString() },
    ip: actor.ip ?? null,
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.CONTRACT_CREATE,
    entity: "PlayerContract",
    entityId: result.newContract.id,
    before: null,
    after: {
      playerId,
      teamId: result.newContract.teamId,
      jerseyNumber: result.newContract.jerseyNumber,
      startDate: result.newContract.startDate.toISOString(),
    },
    ip: actor.ip ?? null,
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PLAYER_TRANSFER,
    entity: "Player",
    entityId: playerId,
    before: {
      teamId: result.oldContract.teamId,
      jerseyNumber: result.oldContract.jerseyNumber,
    },
    after: {
      teamId: result.newContract.teamId,
      jerseyNumber: result.newContract.jerseyNumber,
    },
    ip: actor.ip ?? null,
    metadata: {
      oldContractId: result.oldContract.id,
      newContractId: result.newContract.id,
      transferFee: input.transferFee,
    },
  });

  return result.newContract;
}

// ============================================================================
// 3. CLOSE CONTRACT (Encerramento Avulso)
// ============================================================================

/**
 * Encerra o contrato vigente sem abrir um novo (ex: dispensa ou aposentadoria).
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
    // 1. Encerra o contrato
    const updated = await tx.playerContract.update({
      where: { id: contractId },
      data: { endDate: new Date(), notes: `Encerrado motivo: ${reason}` },
    });

    // 2. Avalia e atualiza o novo status do jogador
    let newStatus = currentContract.player.status;

    if (reason === "RETIRED") {
      newStatus = PlayerStatus.RETIRED;
    } else if (reason === "RELEASED") {
      newStatus = PlayerStatus.FREE_AGENT;
    }

    if (newStatus !== currentContract.player.status) {
      await tx.player.update({
        where: { id: currentContract.playerId },
        data: { status: newStatus },
      });

      // Auditoria paralela pela alteração do status
      await createAuditLog({
        userId: actor.userId,
        action: AUDIT_EVENTS.PLAYER_STATUS_CHANGE,
        entity: "Player",
        entityId: currentContract.playerId,
        before: { status: currentContract.player.status },
        after: { status: newStatus },
        ip: actor.ip ?? null,
        metadata: { reason: `Contrato encerrado. Motivo: ${reason}` },
      });
    }

    return updated;
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.CONTRACT_CLOSE,
    entity: "PlayerContract",
    entityId: contractId,
    before: { endDate: null },
    after: { endDate: closedContract.endDate?.toISOString() },
    ip: actor.ip ?? null,
    metadata: { reason },
  });

  return closedContract;
}

// ============================================================================
// 4. READ (Consultas)
// ============================================================================

export async function getCurrentContract(playerId: string) {
  return db.playerContract.findFirst({
    where: { playerId, endDate: null },
    include: {
      team: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
  });
}

export async function getContractHistory(playerId: string) {
  return db.playerContract.findMany({
    where: { playerId },
    orderBy: { startDate: "desc" },
    include: {
      team: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
  });
}
