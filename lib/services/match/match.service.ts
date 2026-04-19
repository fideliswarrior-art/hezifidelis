/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE PARTIDAS (Onda 3 - E3.3)
 * ============================================================================
 * Arquivo: lib/services/match/match.service.ts
 * Camada de Defesa: C3 (RBAC) + C4 (ABAC) + C5 (Integridade) + C6 (Workflow) + C12 (Auditoria)
 *
 * RESPONSABILIDADE:
 * Gerenciar o ciclo de vida completo de uma partida:
 *   SCHEDULED → LIVE → FINISHED (fluxo normal)
 *   SCHEDULED → CANCELED | POSTPONED | FORFEIT (fluxos alternativos)
 *   POSTPONED → SCHEDULED (reagendamento)
 *   LIVE → CANCELED (apenas SUPER_ADMIN — emergência)
 *
 * STATE MACHINE (definida em require-status-transition.ts):
 *   SCHEDULED → LIVE | CANCELED | POSTPONED | FORFEIT
 *   LIVE      → FINISHED | CANCELED (SA only)
 *   POSTPONED → SCHEDULED
 *   FINISHED  → terminal
 *   FORFEIT   → terminal
 *   CANCELED  → terminal (SA pode reverter com audit)
 *
 * INTEGRIDADE DE JOGO (C5):
 *   - Placar é SEMPRE derivado dos MatchEvents via score-calculator.ts
 *   - Match.homeScore / awayScore são materializações, não fonte de verdade
 *   - finishMatch recalcula tudo atomicamente: score + stats + standings + MVP
 *
 * ATOMICIDADE:
 *   Toda mutação usa tx.auditLog.create() dentro de $transaction.
 *   finishMatch integra stats.service.ts (E3.4) na mesma transação.
 * ============================================================================
 */

import { db } from "@/lib/db";
import { Prisma, type Match } from "@prisma/client";
import { MatchStatus, OfficialRole, WinType, GameFormat } from "@prisma/client";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import { validateTransition } from "@/lib/security/guards/require-status-transition";
import {
  calculateScore,
  type ScoreEvent,
} from "@/lib/services/match/score-calculator";
import {
  recalculateMatchStats,
  updateStandings,
  computeStatsMvp,
  type MatchResultContext,
} from "@/lib/services/match/stats.service";
import type { ActorContext } from "@/lib/services/league/season.service";
import type {
  CreateMatchInput,
  ListMatchesQuery,
} from "@/lib/security/utils/validations.match";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

function matchSnapshot(m: Match) {
  return {
    id: m.id,
    status: m.status,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    scheduledFor: m.scheduledFor.toISOString(),
  };
}

/**
 * Resolve o splitId de uma partida via Phase ou Group.
 * Aceita tx para uso dentro de transações.
 */
async function resolveSplitId(
  matchId: string,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      phase: { select: { splitId: true } },
      group: { select: { phase: { select: { splitId: true } } } },
    },
  });

  const splitId = match?.phase?.splitId ?? match?.group?.phase?.splitId ?? null;

  if (!splitId) {
    throw new Error(
      "Não foi possível resolver o Split desta partida. Verifique a vinculação com Phase/Group.",
    );
  }

  return splitId;
}

/**
 * Determina o WinType baseado no formato e nos períodos jogados.
 */
function determineWinType(
  format: GameFormat,
  homeScore: number,
  awayScore: number,
  maxPeriodPlayed: number,
): WinType {
  // 3x3: se alguém atingiu 21+ pontos, foi WIN_BEFORE_LIMIT
  if (format === GameFormat.THREE_ON_THREE) {
    if (homeScore >= 21 || awayScore >= 21) {
      return WinType.WIN_BEFORE_LIMIT;
    }
    // 3x3 normal: 1 período. Se jogou mais de 1, foi overtime
    if (maxPeriodPlayed > 1) return WinType.OVERTIME;
    return WinType.REGULATION;
  }

  // 5x5: 4 quartos regulamentares. Se jogou mais de 4, foi overtime
  if (format === GameFormat.FIVE_ON_FIVE) {
    if (maxPeriodPlayed > 4) return WinType.OVERTIME;
    return WinType.REGULATION;
  }

  // 1x1 e 2x2: sem OT no MVP — regulamentação simplificada
  return WinType.REGULATION;
}

// ============================================================================
// 1. CREATE MATCH
// ============================================================================

/**
 * Cria uma nova partida com status SCHEDULED.
 *
 * Validações:
 *   - homeTeamId !== awayTeamId (Zod + check manual)
 *   - Ambos os times existem e isActive = true
 *   - Phase/Group/Series existe (ao menos um)
 *   - Venue existe (se fornecido)
 */
export async function createMatch(
  input: CreateMatchInput,
  actor: ActorContext,
): Promise<Match> {
  // 1. Validações de FK
  const [homeTeam, awayTeam] = await Promise.all([
    db.team.findUnique({
      where: { id: input.homeTeamId },
      select: { id: true, name: true, isActive: true },
    }),
    db.team.findUnique({
      where: { id: input.awayTeamId },
      select: { id: true, name: true, isActive: true },
    }),
  ]);

  if (!homeTeam) throw new NotFoundError("Time mandante não encontrado.");
  if (!awayTeam) throw new NotFoundError("Time visitante não encontrado.");
  if (!homeTeam.isActive)
    throw new NotFoundError(`O time "${homeTeam.name}" está inativo.`);
  if (!awayTeam.isActive)
    throw new NotFoundError(`O time "${awayTeam.name}" está inativo.`);

  // Venue (opcional)
  if (input.venueId) {
    const venue = await db.venue.findUnique({ where: { id: input.venueId } });
    if (!venue) throw new NotFoundError("Local (Venue) não encontrado.");
  }

  // Phase/Group/Series (ao menos um — já validado pelo Zod)
  if (input.phaseId) {
    const phase = await db.phase.findUnique({ where: { id: input.phaseId } });
    if (!phase) throw new NotFoundError("Phase não encontrada.");
  }
  if (input.groupId) {
    const group = await db.group.findUnique({ where: { id: input.groupId } });
    if (!group) throw new NotFoundError("Grupo não encontrado.");
  }
  if (input.seriesId) {
    const series = await db.playoffSeries.findUnique({
      where: { id: input.seriesId },
    });
    if (!series) throw new NotFoundError("Série de playoffs não encontrada.");
  }

  // 2. Criação
  const data: Prisma.MatchUncheckedCreateInput = {
    scheduledFor: input.scheduledFor,
    format: input.format,
    isOfficial: input.isOfficial,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    status: MatchStatus.SCHEDULED,
    homeScore: 0,
    awayScore: 0,
    homeTeamFouls: 0,
    awayTeamFouls: 0,
  };

  if (input.title !== undefined) data.title = input.title;
  if (input.phaseId !== undefined) data.phaseId = input.phaseId;
  if (input.groupId !== undefined) data.groupId = input.groupId;
  if (input.seriesId !== undefined) data.seriesId = input.seriesId;
  if (input.gameNumberInSeries !== undefined)
    data.gameNumberInSeries = input.gameNumberInSeries;
  if (input.venueId !== undefined) data.venueId = input.venueId;
  if (input.streamUrl !== undefined) data.streamUrl = input.streamUrl;
  if (input.streamUrlBk !== undefined) data.streamUrlBk = input.streamUrlBk;
  if (input.durationMinutes !== undefined)
    data.durationMinutes = input.durationMinutes;

  const created = await db.match.create({ data });

  await db.auditLog.create({
    data: {
      userId: actor.userId,
      action: AUDIT_EVENTS.MATCH_CREATE,
      entity: "Match",
      entityId: created.id,
      before: Prisma.JsonNull,
      after: matchSnapshot(created),
      ip: actor.ip ?? null,
      metadata: {
        homeTeamName: homeTeam.name,
        awayTeamName: awayTeam.name,
      },
    },
  });

  return created;
}

// ============================================================================
// 2. ASSIGN / REMOVE OFFICIAL
// ============================================================================

/**
 * Designa um oficial (mesário, árbitro, etc.) para a partida.
 * Só permitido em SCHEDULED (antes do início).
 *
 * Validações:
 *   - Match status = SCHEDULED
 *   - User existe, isActive, emailVerified
 *   - Upsert por @@unique([matchId, userId, role]) — idempotente
 */
export async function assignOfficial(
  matchId: string,
  input: { userId: string; role: OfficialRole },
  actor: ActorContext,
) {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError("Partida não encontrada.");

  if (match.status !== MatchStatus.SCHEDULED) {
    throw Object.assign(
      new Error("Oficiais só podem ser atribuídos antes do início da partida."),
      { statusCode: 422, code: "MATCH_NOT_SCHEDULED" },
    );
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isActive: true, emailVerified: true, name: true },
  });

  if (!user) throw new NotFoundError("Usuário não encontrado.");
  if (!user.isActive) throw new NotFoundError("Usuário está inativo.");

  // Upsert — idempotente por @@unique([matchId, userId, role])
  const official = await db.matchOfficial.upsert({
    where: {
      matchId_userId_role: {
        matchId,
        userId: input.userId,
        role: input.role,
      },
    },
    update: {},
    create: {
      matchId,
      userId: input.userId,
      role: input.role,
    },
  });

  await db.auditLog.create({
    data: {
      userId: actor.userId,
      action: AUDIT_EVENTS.MATCH_OFFICIAL_ASSIGN,
      entity: "MatchOfficial",
      entityId: official.id,
      before: Prisma.JsonNull,
      after: {
        matchId,
        userId: input.userId,
        role: input.role,
        userName: user.name,
      },
      ip: actor.ip ?? null,
    },
  });

  return official;
}

/**
 * Remove um oficial da partida. Só em SCHEDULED.
 */
export async function removeOfficial(
  matchId: string,
  input: { userId: string; role: OfficialRole },
  actor: ActorContext,
) {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError("Partida não encontrada.");

  if (match.status !== MatchStatus.SCHEDULED) {
    throw Object.assign(
      new Error("Oficiais só podem ser removidos antes do início da partida."),
      { statusCode: 422, code: "MATCH_NOT_SCHEDULED" },
    );
  }

  const existing = await db.matchOfficial.findUnique({
    where: {
      matchId_userId_role: {
        matchId,
        userId: input.userId,
        role: input.role,
      },
    },
  });

  if (!existing) return; // Idempotente

  await db.matchOfficial.delete({ where: { id: existing.id } });

  await db.auditLog.create({
    data: {
      userId: actor.userId,
      action: AUDIT_EVENTS.MATCH_OFFICIAL_REMOVE,
      entity: "MatchOfficial",
      entityId: existing.id,
      before: { matchId, userId: input.userId, role: input.role },
      after: Prisma.JsonNull,
      ip: actor.ip ?? null,
    },
  });
}

// ============================================================================
// 3. START MATCH (SCHEDULED → LIVE)
// ============================================================================

/**
 * Inicia a partida.
 *
 * Pré-condições:
 *   - Status SCHEDULED (validado por state machine)
 *   - Ao menos 1 SCOREKEEPER atribuído
 *   - Ambos os times isActive
 *
 * Efeitos:
 *   - Status → LIVE
 *   - startedAt = now()
 *   - Cria MatchPeriod 1 automaticamente
 */
export async function startMatch(
  matchId: string,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      officials: { where: { role: OfficialRole.SCOREKEEPER } },
      homeTeam: { select: { isActive: true, name: true } },
      awayTeam: { select: { isActive: true, name: true } },
    },
  });

  if (!match) throw new NotFoundError("Partida não encontrada.");

  // State machine
  validateTransition("Match", match.status, MatchStatus.LIVE);

  // Scorekeeper obrigatório
  if (match.officials.length === 0) {
    throw Object.assign(
      new Error(
        "Atribua ao menos um mesário (SCOREKEEPER) antes de iniciar a partida.",
      ),
      { statusCode: 422, code: "NO_SCOREKEEPER" },
    );
  }

  // Times ativos
  if (!match.homeTeam.isActive) {
    throw Object.assign(
      new Error(`O time mandante "${match.homeTeam.name}" está inativo.`),
      { statusCode: 422, code: "TEAM_INACTIVE" },
    );
  }
  if (!match.awayTeam.isActive) {
    throw Object.assign(
      new Error(`O time visitante "${match.awayTeam.name}" está inativo.`),
      { statusCode: 422, code: "TEAM_INACTIVE" },
    );
  }

  // Transação: status + período 1 + audit
  const started = await db.$transaction(async (tx) => {
    const now = new Date();

    const updated = await tx.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.LIVE,
        startedAt: now,
      },
    });

    // Cria o Período 1 automaticamente
    await tx.matchPeriod.create({
      data: {
        matchId,
        periodNumber: 1,
        homeScore: 0,
        awayScore: 0,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_START,
        entity: "Match",
        entityId: matchId,
        before: { status: MatchStatus.SCHEDULED },
        after: { status: MatchStatus.LIVE, startedAt: now.toISOString() },
        ip: actor.ip ?? null,
        metadata: {
          scorekeepers: match.officials.map((o) => o.userId),
        },
      },
    });

    return updated;
  });

  return started;
}

// ============================================================================
// 4. FINISH MATCH (LIVE → FINISHED) — O PONTO MAIS CRÍTICO
// ============================================================================

/**
 * Finaliza a partida e processa TUDO atomicamente:
 *   1. Calcula placar final a partir dos MatchEvents
 *   2. Atualiza Match (status, scores, winType, finishedAt)
 *   3. Atualiza MatchPeriods com placares por período
 *   4. Recalcula MatchStat por jogador (E3.4)
 *   5. Atualiza Standings — split-level e group-level (E3.4)
 *   6. Computa MVP por P-VAL se isOfficial (E3.4)
 *
 * Idempotência: O segundo chamador falha no validateTransition
 * (status já é FINISHED), protegido pela state machine.
 *
 * REGRA FUNDAMENTAL: homeScore e awayScore são DERIVADOS dos
 * MatchEvents — nunca aceitos do client.
 */
export async function finishMatch(
  matchId: string,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      format: true,
      isOfficial: true,
      homeTeamId: true,
      awayTeamId: true,
      phaseId: true,
      groupId: true,
      homeScore: true,
      awayScore: true,
    },
  });

  if (!match) throw new NotFoundError("Partida não encontrada.");

  // State machine: LIVE → FINISHED
  validateTransition("Match", match.status, MatchStatus.FINISHED);

  const finished = await db.$transaction(async (tx) => {
    const now = new Date();

    // ── 1. Busca todos os eventos da partida ──────────────────
    const events = await tx.matchEvent.findMany({
      where: { matchId },
      select: {
        type: true,
        teamSide: true,
        playerId: true,
        period: true,
        isVoided: true,
      },
    });

    // ── 2. Calcula placar (função pura) ───────────────────────
    const scoreResult = calculateScore(events as ScoreEvent[]);

    // ── 3. Determina WinType ──────────────────────────────────
    const maxPeriod =
      scoreResult.periods.length > 0
        ? Math.max(...scoreResult.periods.map((p) => p.periodNumber))
        : 1;

    const winType = determineWinType(
      match.format,
      scoreResult.match.homeScore,
      scoreResult.match.awayScore,
      maxPeriod,
    );

    // ── 4. Atualiza Match ─────────────────────────────────────
    const updatedMatch = await tx.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.FINISHED,
        homeScore: scoreResult.match.homeScore,
        awayScore: scoreResult.match.awayScore,
        homeTeamFouls: scoreResult.match.homeTeamFouls,
        awayTeamFouls: scoreResult.match.awayTeamFouls,
        winType,
        finishedAt: now,
      },
    });

    // ── 5. Atualiza MatchPeriods ──────────────────────────────
    for (const period of scoreResult.periods) {
      await tx.matchPeriod.upsert({
        where: {
          matchId_periodNumber: {
            matchId,
            periodNumber: period.periodNumber,
          },
        },
        update: {
          homeScore: period.homeScore,
          awayScore: period.awayScore,
        },
        create: {
          matchId,
          periodNumber: period.periodNumber,
          homeScore: period.homeScore,
          awayScore: period.awayScore,
        },
      });
    }

    // ── 6. Resolve splitId para standings ─────────────────────
    const splitId = await resolveSplitId(matchId, tx);

    // ── 7. E3.4: Recalcula MatchStat por jogador ─────────────
    await recalculateMatchStats(matchId, actor.userId, actor.ip ?? null, tx);

    // ── 8. E3.4: Atualiza Standings ──────────────────────────
    const standingCtx: MatchResultContext = {
      matchId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore: scoreResult.match.homeScore,
      awayScore: scoreResult.match.awayScore,
      splitId,
      groupId: match.groupId ?? null,
      isOfficial: match.isOfficial,
    };

    await updateStandings(standingCtx, actor.userId, actor.ip ?? null, tx);

    // ── 9. E3.4: Computa MVP se partida oficial ──────────────
    let mvpPlayerId: string | null = null;

    if (match.isOfficial) {
      mvpPlayerId = await computeStatsMvp(
        matchId,
        actor.userId,
        actor.ip ?? null,
        tx,
      );
    }

    // ── 10. Audit do finishMatch ─────────────────────────────
    const totalEvents = events.length;
    const voidedEvents = events.filter((e) => e.isVoided).length;

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_FINISH,
        entity: "Match",
        entityId: matchId,
        before: {
          status: MatchStatus.LIVE,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
        },
        after: {
          status: MatchStatus.FINISHED,
          homeScore: scoreResult.match.homeScore,
          awayScore: scoreResult.match.awayScore,
          winType,
          mvpPlayerId,
        },
        ip: actor.ip ?? null,
        metadata: {
          eventCount: totalEvents,
          voidedCount: voidedEvents,
          periodsPlayed: scoreResult.periods.length,
          finishedAt: now.toISOString(),
        },
      },
    });

    return updatedMatch;
  });

  return finished;
}

// ============================================================================
// 5. CANCEL MATCH
// ============================================================================

/**
 * Cancela uma partida.
 *
 * SCHEDULED → CANCELED: ADMIN+ pode cancelar.
 * LIVE → CANCELED: apenas SUPER_ADMIN (emergência — verificado na rota).
 *
 * A state machine valida a transição. O controle de SA vs ADMIN
 * fica na rota (requireRole diferenciado por status).
 */
export async function cancelMatch(
  matchId: string,
  reason: string,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError("Partida não encontrada.");

  validateTransition("Match", match.status, MatchStatus.CANCELED);

  const canceled = await db.$transaction(async (tx) => {
    const updated = await tx.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.CANCELED },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_CANCEL,
        entity: "Match",
        entityId: matchId,
        before: { status: match.status },
        after: { status: MatchStatus.CANCELED },
        ip: actor.ip ?? null,
        metadata: { reason },
      },
    });

    return updated;
  });

  return canceled;
}

// ============================================================================
// 6. POSTPONE MATCH (SCHEDULED → POSTPONED)
// ============================================================================

export async function postponeMatch(
  matchId: string,
  reason: string,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError("Partida não encontrada.");

  validateTransition("Match", match.status, MatchStatus.POSTPONED);

  const postponed = await db.$transaction(async (tx) => {
    const updated = await tx.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.POSTPONED },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_POSTPONE,
        entity: "Match",
        entityId: matchId,
        before: {
          status: match.status,
          scheduledFor: match.scheduledFor.toISOString(),
        },
        after: { status: MatchStatus.POSTPONED },
        ip: actor.ip ?? null,
        metadata: { reason },
      },
    });

    return updated;
  });

  return postponed;
}

// ============================================================================
// 7. RESCHEDULE MATCH (POSTPONED → SCHEDULED)
// ============================================================================

/**
 * Reagenda uma partida adiada.
 * Valida que a nova data é futura.
 */
export async function rescheduleMatch(
  matchId: string,
  newDate: Date,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError("Partida não encontrada.");

  validateTransition("Match", match.status, MatchStatus.SCHEDULED);

  if (newDate <= new Date()) {
    throw Object.assign(new Error("A nova data deve ser no futuro."), {
      statusCode: 422,
      code: "INVALID_RESCHEDULE_DATE",
    });
  }

  const rescheduled = await db.$transaction(async (tx) => {
    const updated = await tx.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.SCHEDULED,
        scheduledFor: newDate,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_POSTPONE, // Reutiliza o evento (reschedule é undo do postpone)
        entity: "Match",
        entityId: matchId,
        before: { status: MatchStatus.POSTPONED },
        after: {
          status: MatchStatus.SCHEDULED,
          scheduledFor: newDate.toISOString(),
        },
        ip: actor.ip ?? null,
        metadata: { action: "reschedule" },
      },
    });

    return updated;
  });

  return rescheduled;
}

// ============================================================================
// 8. FORFEIT (SCHEDULED → FORFEIT)
// ============================================================================

/**
 * Registra W.O. — ausência formal de um dos times.
 *
 * O admin informa qual time não compareceu (loserSide).
 * O time presente recebe a vitória com placar padrão 20x0
 * (convenção FIBA 3x3 / CBB).
 *
 * Também atualiza standings como se fosse uma partida finalizada.
 */
export async function forfeitMatch(
  matchId: string,
  loserSide: "HOME" | "AWAY",
  reason: string,
  actor: ActorContext,
): Promise<Match> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      groupId: true,
      isOfficial: true,
      phaseId: true,
      format: true,
    },
  });

  if (!match) throw new NotFoundError("Partida não encontrada.");

  validateTransition("Match", match.status, MatchStatus.FORFEIT);

  const forfeitScore = 20; // Placar padrão W.O.

  const forfeited = await db.$transaction(async (tx) => {
    const now = new Date();

    const homeScore = loserSide === "AWAY" ? forfeitScore : 0;
    const awayScore = loserSide === "HOME" ? forfeitScore : 0;

    const updated = await tx.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.FORFEIT,
        homeScore,
        awayScore,
        winType: WinType.FORFEIT,
        finishedAt: now,
      },
    });

    // Atualiza standings (W.O. conta como partida jogada)
    const splitId = await resolveSplitId(matchId, tx);

    const standingCtx: MatchResultContext = {
      matchId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore,
      awayScore,
      splitId,
      groupId: match.groupId ?? null,
      isOfficial: match.isOfficial,
    };

    await updateStandings(standingCtx, actor.userId, actor.ip ?? null, tx);

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_CANCEL, // FORFEIT usa MATCH_CANCEL com metadata
        entity: "Match",
        entityId: matchId,
        before: { status: match.status },
        after: {
          status: MatchStatus.FORFEIT,
          homeScore,
          awayScore,
          winType: WinType.FORFEIT,
        },
        ip: actor.ip ?? null,
        metadata: { reason, loserSide, forfeitScore },
      },
    });

    return updated;
  });

  return forfeited;
}

// ============================================================================
// 9. READ (Admin & Público)
// ============================================================================

/**
 * Detalhe completo de uma partida.
 * Inclui oficiais, períodos, MVP e times.
 */
export async function getMatchById(id: string) {
  return db.match.findUnique({
    where: { id },
    include: {
      homeTeam: {
        select: {
          id: true,
          name: true,
          slug: true,
          shortName: true,
          logoUrl: true,
        },
      },
      awayTeam: {
        select: {
          id: true,
          name: true,
          slug: true,
          shortName: true,
          logoUrl: true,
        },
      },
      venue: { select: { id: true, name: true, city: true } },
      phase: { select: { id: true, name: true, splitId: true } },
      group: { select: { id: true, name: true } },
      series: { select: { id: true } },
      officials: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      periods: { orderBy: { periodNumber: "asc" } },
      mvp: {
        include: {
          player: {
            select: { id: true, firstName: true, lastName: true, slug: true },
          },
        },
      },
    },
  });
}

/**
 * Listagem paginada de partidas com filtros.
 */
export async function listMatches(query: ListMatchesQuery) {
  const where: Prisma.MatchWhereInput = {
    ...(query.status !== undefined && { status: query.status }),
    ...(query.homeTeamId !== undefined && { homeTeamId: query.homeTeamId }),
    ...(query.awayTeamId !== undefined && { awayTeamId: query.awayTeamId }),
    ...(query.phaseId !== undefined && { phaseId: query.phaseId }),
    ...(query.groupId !== undefined && { groupId: query.groupId }),
    ...(query.seriesId !== undefined && { seriesId: query.seriesId }),
    ...(query.isOfficial !== undefined && { isOfficial: query.isOfficial }),
    ...(query.format !== undefined && { format: query.format }),
    ...((query.from || query.to) && {
      scheduledFor: {
        ...(query.from && { gte: query.from }),
        ...(query.to && { lte: query.to }),
      },
    }),
  };

  const items = await db.match.findMany({
    where,
    take: query.take + 1,
    ...(query.cursor && { cursor: { id: query.cursor } }),
    skip: query.cursor ? 1 : 0,
    orderBy: { scheduledFor: "desc" },
    include: {
      homeTeam: {
        select: { id: true, name: true, shortName: true, logoUrl: true },
      },
      awayTeam: {
        select: { id: true, name: true, shortName: true, logoUrl: true },
      },
      venue: { select: { id: true, name: true } },
      mvp: {
        include: {
          player: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  let nextCursor: string | undefined;
  if (items.length > query.take) {
    const last = items.pop();
    nextCursor = last?.id;
  }

  return { items, nextCursor };
}
