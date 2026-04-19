/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE ESTATÍSTICAS (Onda 3 - E3.3 / E3.4)
 * ============================================================================
 * Arquivo: lib/services/match/stats.service.ts
 * Camada de Defesa: C5 (Integridade de Jogo) + C12 (Auditoria)
 *
 * RESPONSABILIDADE:
 * Agregar MatchEvents em MatchStat, recalcular Standings, e determinar
 * MVP por P-VAL. Todas as funções aceitam `tx` (Prisma TransactionClient)
 * porque são chamadas dentro da $transaction do finishMatch.
 *
 * PRINCÍPIO FUNDAMENTAL:
 * Estatísticas são SEMPRE derivadas dos MatchEvents. Nunca aceitas do
 * client. O admin pode editar highlight stats (buzzerBeaters, drives,
 * keyAssists) manualmente via MatchStat, mas os campos base são
 * recalculados a cada finishMatch.
 *
 * FUNÇÕES EXPORTADAS (ordem de chamada no finishMatch):
 *   1. recalculateMatchStats — Agrega eventos → MatchStat por jogador
 *   2. updateStandings       — Atualiza classificação (split + group)
 *   3. computeStatsMvp       — Calcula P-VAL e elege MVP (official only)
 *
 * SISTEMA DE PONTOS DA CLASSIFICAÇÃO:
 *   Vitória = 2 pontos | Derrota = 0 pontos
 *   (Padrão do basquete brasileiro — CBB/LNB)
 *
 * CRITÉRIOS DE ORDENAÇÃO (Standing.position):
 *   1º Pontos na tabela (DESC)
 *   2º Saldo de pontos (pointsDiff DESC)
 *   3º Pontos marcados (pointsFor DESC)
 * ============================================================================
 */

import { Prisma } from "@prisma/client";
import { TeamSide, MvpSource } from "@prisma/client";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import {
  aggregatePlayerStats,
  calculatePVal,
  type ScoreEvent,
  type PlayerEventStats,
} from "@/lib/services/match/score-calculator";

// ============================================================================
// TIPOS
// ============================================================================

/**
 * Contexto da partida finalizada, montado pelo match.service.ts
 * e passado para updateStandings.
 */
export interface MatchResultContext {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  splitId: string;
  groupId: string | null;
  isOfficial: boolean;
}

// ============================================================================
// CONSTANTES
// ============================================================================

/** Pontos na tabela de classificação por resultado. */
const STANDING_POINTS_WIN = 2;
const STANDING_POINTS_LOSS = 0;

// ============================================================================
// 1. RECALCULATE MATCH STATS
// ============================================================================

/**
 * Agrega todos os MatchEvents não-anulados em MatchStat por jogador.
 *
 * Para cada jogador que participou (tem ao menos 1 evento):
 *   - Calcula pontos, arremessos, rebotes, roubos, bloqueios, turnovers, faltas
 *   - Calcula shootingEfficiency e playerValue (P-VAL)
 *   - Upsert no MatchStat via @@unique([matchId, playerId])
 *
 * @param matchId — ID da partida
 * @param actorId — userId do admin que finalizou (para audit)
 * @param ip — IP do admin
 * @param tx — Transaction client (chamado dentro de $transaction)
 */
export async function recalculateMatchStats(
  matchId: string,
  actorId: string,
  ip: string | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  // 1. Busca todos os eventos da partida
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

  // 2. Agrega estatísticas por jogador (função pura)
  const playerStatsMap = aggregatePlayerStats(events as ScoreEvent[]);

  // 3. Upsert MatchStat para cada jogador
  let statsCount = 0;

  for (const [playerId, stats] of playerStatsMap) {
    const { shootingEfficiency, playerValue } = calculatePVal(stats);

    const totalRebounds = stats.offensiveRebounds + stats.defensiveRebounds;
    const fieldGoalsMade = stats.twoPointersMade + stats.threePointersMade;
    const fieldGoalsAttempted =
      stats.twoPointersAttempted + stats.threePointersAttempted;

    await tx.matchStat.upsert({
      where: {
        matchId_playerId: { matchId, playerId },
      },
      update: {
        points: stats.points,
        assists: stats.assists,
        rebounds: totalRebounds,
        offensiveRebounds: stats.offensiveRebounds,
        defensiveRebounds: stats.defensiveRebounds,
        steals: stats.steals,
        blocks: stats.blocks,
        turnovers: stats.turnovers,
        fouls: stats.fouls,
        fieldGoalsMade,
        fieldGoalsAttempted,
        twoPointersMade: stats.twoPointersMade,
        twoPointersAttempted: stats.twoPointersAttempted,
        threePointersMade: stats.threePointersMade,
        threePointersAttempted: stats.threePointersAttempted,
        freeThrowsMade: stats.freeThrowsMade,
        freeThrowsAttempted: stats.freeThrowsAttempted,
        shootingEfficiency,
        playerValue,
      },
      create: {
        matchId,
        playerId,
        points: stats.points,
        assists: stats.assists,
        rebounds: totalRebounds,
        offensiveRebounds: stats.offensiveRebounds,
        defensiveRebounds: stats.defensiveRebounds,
        steals: stats.steals,
        blocks: stats.blocks,
        turnovers: stats.turnovers,
        fouls: stats.fouls,
        fieldGoalsMade,
        fieldGoalsAttempted,
        twoPointersMade: stats.twoPointersMade,
        twoPointersAttempted: stats.twoPointersAttempted,
        threePointersMade: stats.threePointersMade,
        threePointersAttempted: stats.threePointersAttempted,
        freeThrowsMade: stats.freeThrowsMade,
        freeThrowsAttempted: stats.freeThrowsAttempted,
        shootingEfficiency,
        playerValue,
      },
    });

    statsCount++;
  }

  // 4. Audit
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: AUDIT_EVENTS.STATS_RECALCULATE,
      entity: "Match",
      entityId: matchId,
      before: Prisma.JsonNull,
      after: { playersProcessed: statsCount },
      ip,
    },
  });
}

// ============================================================================
// 2. UPDATE STANDINGS (Classificação)
// ============================================================================

/**
 * Atualiza a tabela de classificação após uma partida finalizada.
 *
 * Atualiza em dois escopos:
 *   1. Split-level (sempre) — classificação geral do torneio
 *   2. Group-level (se match tem groupId) — classificação do grupo
 *
 * Após atualizar os dois times, recalcula posições de TODOS os times
 * no mesmo escopo (sort por pontos → saldo → pontos marcados).
 *
 * @param ctx — Contexto com IDs dos times, placar final, split e group
 * @param actorId — userId do admin (para audit)
 * @param ip — IP do admin
 * @param tx — Transaction client
 */
export async function updateStandings(
  ctx: MatchResultContext,
  actorId: string,
  ip: string | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const homeWon = ctx.homeScore > ctx.awayScore;

  // ── Split-level standings (sempre) ──────────────────────────
  await upsertTeamStanding(
    tx,
    ctx.homeTeamId,
    { splitId: ctx.splitId, groupId: null },
    ctx.homeScore,
    ctx.awayScore,
    homeWon,
  );

  await upsertTeamStanding(
    tx,
    ctx.awayTeamId,
    { splitId: ctx.splitId, groupId: null },
    ctx.awayScore,
    ctx.homeScore,
    !homeWon,
  );

  await recalculatePositions(tx, { splitId: ctx.splitId });

  // ── Group-level standings (se existe) ───────────────────────
  if (ctx.groupId) {
    await upsertTeamStanding(
      tx,
      ctx.homeTeamId,
      { splitId: null, groupId: ctx.groupId },
      ctx.homeScore,
      ctx.awayScore,
      homeWon,
    );

    await upsertTeamStanding(
      tx,
      ctx.awayTeamId,
      { splitId: null, groupId: ctx.groupId },
      ctx.awayScore,
      ctx.homeScore,
      !homeWon,
    );

    await recalculatePositions(tx, { groupId: ctx.groupId });
  }

  // Audit
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: AUDIT_EVENTS.STANDING_RECALCULATE,
      entity: "Match",
      entityId: ctx.matchId,
      before: Prisma.JsonNull,
      after: {
        homeTeamId: ctx.homeTeamId,
        awayTeamId: ctx.awayTeamId,
        homeScore: ctx.homeScore,
        awayScore: ctx.awayScore,
        splitId: ctx.splitId,
        groupId: ctx.groupId,
      },
      ip,
    },
  });
}

// ============================================================================
// 3. COMPUTE STATS MVP (P-VAL)
// ============================================================================

/**
 * Determina o MVP da partida baseado no maior P-VAL (playerValue).
 *
 * Chamado apenas para partidas oficiais (isOfficial = true).
 * Para peladas, o MVP vai pra votação do Instagram (fluxo manual).
 *
 * Critérios de desempate:
 *   1º Maior playerValue (P-VAL)
 *   2º Maior points (pontos brutos)
 *   3º Primeiro no banco (consistência determinística)
 *
 * Atomicidade:
 *   - Cria MatchMvp (1:1 com Match via @unique matchId)
 *   - Sincroniza isMvp=true no MatchStat do vencedor
 *   - Garante que todos os outros MatchStat.isMvp = false
 *
 * @param matchId — ID da partida
 * @param actorId — userId do admin (para audit)
 * @param ip — IP do admin
 * @param tx — Transaction client
 * @returns playerId do MVP ou null se nenhum candidato
 */
export async function computeStatsMvp(
  matchId: string,
  actorId: string,
  ip: string | null,
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  // 1. Busca todos os MatchStats da partida, ordenados por P-VAL e pontos
  const stats = await tx.matchStat.findMany({
    where: { matchId },
    orderBy: [{ playerValue: "desc" }, { points: "desc" }],
  });

  if (stats.length === 0) return null;

  const mvpStat = stats[0]!;

  // 2. Reseta isMvp de todos (segurança — previne duplicatas)
  await tx.matchStat.updateMany({
    where: { matchId, isMvp: true },
    data: { isMvp: false },
  });

  // 3. Marca o vencedor
  await tx.matchStat.update({
    where: { matchId_playerId: { matchId, playerId: mvpStat.playerId } },
    data: { isMvp: true },
  });

  // 4. Cria MatchMvp (upsert por @unique matchId — idempotente)
  await tx.matchMvp.upsert({
    where: { matchId },
    update: {
      playerId: mvpStat.playerId,
      source: MvpSource.STATS,
    },
    create: {
      matchId,
      playerId: mvpStat.playerId,
      source: MvpSource.STATS,
    },
  });

  // 5. Audit
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: AUDIT_EVENTS.MVP_STATS_COMPUTED,
      entity: "Match",
      entityId: matchId,
      before: Prisma.JsonNull,
      after: {
        mvpPlayerId: mvpStat.playerId,
        playerValue: mvpStat.playerValue,
        points: mvpStat.points,
        source: MvpSource.STATS,
      },
      ip,
    },
  });

  return mvpStat.playerId;
}

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

/**
 * Upsert de Standing para um time em um escopo (split OU group).
 *
 * Lógica:
 *   - Se não existe → cria com os dados da primeira partida
 *   - Se existe → incrementa gamesPlayed, wins/losses, pontos, etc.
 *   - Streak é atualizado incrementalmente
 *
 * NOTA: `position` é setado como 0 no create — será recalculado
 * por recalculatePositions() logo após todos os upserts do round.
 */
async function upsertTeamStanding(
  tx: Prisma.TransactionClient,
  teamId: string,
  scope: { splitId: string | null; groupId: string | null },
  pointsScored: number,
  pointsConceded: number,
  won: boolean,
): Promise<void> {
  const standingPoints = won ? STANDING_POINTS_WIN : STANDING_POINTS_LOSS;
  const diff = pointsScored - pointsConceded;

  // Busca standing existente
  const existing = await tx.standing.findFirst({
    where: {
      teamId,
      ...(scope.splitId ? { splitId: scope.splitId } : { splitId: null }),
      ...(scope.groupId ? { groupId: scope.groupId } : { groupId: null }),
    },
  });

  if (existing) {
    const newStreak = updateStreak(existing.streak, won);

    await tx.standing.update({
      where: { id: existing.id },
      data: {
        gamesPlayed: { increment: 1 },
        ...(won ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
        points: { increment: standingPoints },
        pointsFor: { increment: pointsScored },
        pointsAgainst: { increment: pointsConceded },
        pointsDiff: { increment: diff },
        streak: newStreak,
      },
    });
  } else {
    await tx.standing.create({
      data: {
        teamId,
        splitId: scope.splitId,
        groupId: scope.groupId,
        position: 0, // Temporário — recalculado por recalculatePositions
        gamesPlayed: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        points: standingPoints,
        pointsFor: pointsScored,
        pointsAgainst: pointsConceded,
        pointsDiff: diff,
        streak: won ? "W1" : "L1",
      },
    });
  }
}

/**
 * Recalcula posições de TODOS os times em um escopo (split OU group).
 *
 * Critérios de ordenação:
 *   1. points DESC (pontos na tabela)
 *   2. pointsDiff DESC (saldo de pontos)
 *   3. pointsFor DESC (pontos marcados — desempate final)
 *
 * Atualiza apenas standings cujo position mudou (otimização).
 */
async function recalculatePositions(
  tx: Prisma.TransactionClient,
  scope: { splitId?: string; groupId?: string },
): Promise<void> {
  const where: Prisma.StandingWhereInput = {};

  if (scope.splitId) {
    where.splitId = scope.splitId;
    where.groupId = null; // Só split-level
  } else if (scope.groupId) {
    where.groupId = scope.groupId;
    where.splitId = null; // Só group-level
  }

  const standings = await tx.standing.findMany({
    where,
    orderBy: [
      { points: "desc" },
      { pointsDiff: "desc" },
      { pointsFor: "desc" },
    ],
  });

  for (let i = 0; i < standings.length; i++) {
    const newPosition = i + 1;
    const standing = standings[i]!;

    if (standing.position !== newPosition) {
      await tx.standing.update({
        where: { id: standing.id },
        data: { position: newPosition },
      });
    }
  }
}

/**
 * Atualiza streak incrementalmente.
 *
 * Formato: "W3" (3 vitórias seguidas), "L2" (2 derrotas seguidas)
 *
 * Regras:
 *   - Se ganhou e streak atual é "WN" → "W(N+1)"
 *   - Se ganhou e streak atual é "LN" ou null → "W1"
 *   - Se perdeu e streak atual é "LN" → "L(N+1)"
 *   - Se perdeu e streak atual é "WN" ou null → "L1"
 */
function updateStreak(currentStreak: string | null, won: boolean): string {
  const prefix = won ? "W" : "L";

  if (!currentStreak) return `${prefix}1`;

  const currentPrefix = currentStreak[0];
  const currentCount = parseInt(currentStreak.slice(1), 10);

  if (currentPrefix === prefix && !isNaN(currentCount)) {
    return `${prefix}${currentCount + 1}`;
  }

  return `${prefix}1`;
}
