/**
 * ============================================================================
 * HEZI TECH — CALCULADORA DE PLACAR (Onda 3 - E3.3)
 * ============================================================================
 * Arquivo: lib/services/match/score-calculator.ts
 * Camada de Defesa: C5 (Integridade de Jogo)
 *
 * FUNÇÃO PURA — sem side-effects, sem acesso ao banco, sem imports de db.
 * Recebe arrays de eventos, retorna cálculos. Testável isoladamente.
 *
 * PRINCÍPIO (§0.1.3 — Server-side autoritativo):
 * O placar é SEMPRE derivado dos MatchEvents. Os campos Match.homeScore,
 * Match.awayScore, MatchPeriod.homeScore, MatchPeriod.awayScore são
 * materializações para leitura rápida, mas reconstituíveis a qualquer
 * momento por esta função.
 *
 * CONSUMIDORES:
 *   - match-event.service.ts → recalcula após registerEvent / voidEvent
 *   - match.service.ts → valida placar final no finishMatch
 *   - stats.service.ts → agrega estatísticas por jogador (E3.4)
 * ============================================================================
 */

import { MatchEventType, TeamSide } from "@prisma/client";
import {
  SCORING_EVENTS,
  PLAYER_EVENTS,
} from "@/lib/security/utils/validations.match";

// ============================================================================
// TIPOS
// ============================================================================

/** Estrutura mínima de um evento para cálculos. */
export interface ScoreEvent {
  type: MatchEventType;
  teamSide: TeamSide | null;
  playerId: string | null;
  period: number | null;
  isVoided: boolean;
}

/** Placar total de uma partida. */
export interface MatchScore {
  homeScore: number;
  awayScore: number;
  homeTeamFouls: number;
  awayTeamFouls: number;
}

/** Placar de um período individual. */
export interface PeriodScore {
  periodNumber: number;
  homeScore: number;
  awayScore: number;
}

/** Resultado completo do cálculo. */
export interface ScoreResult {
  match: MatchScore;
  periods: PeriodScore[];
}

/** Estatísticas brutas de um jogador (agregação de eventos). */
export interface PlayerEventStats {
  playerId: string;
  teamSide: TeamSide;
  points: number;
  twoPointersMade: number;
  twoPointersAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  assists: number;
}

// ============================================================================
// MAPEAMENTO DE PONTOS POR TIPO DE EVENTO
// ============================================================================

/**
 * Quantos pontos cada tipo de evento de pontuação vale.
 * Usado para derivar `value` server-side (nunca aceito do client).
 */
const POINTS_MAP: ReadonlyMap<MatchEventType, number> = new Map([
  [MatchEventType.FREE_THROW_MADE, 1],
  [MatchEventType.TWO_POINT_MADE, 2],
  [MatchEventType.THREE_POINT_MADE, 3],
]);

/**
 * Retorna quantos pontos um tipo de evento vale.
 * Retorna 0 para eventos não-pontuáveis.
 */
export function getPointsForEventType(type: MatchEventType): number {
  return POINTS_MAP.get(type) ?? 0;
}

/** Tipos de falta que incrementam o contador de faltas de equipe. */
const FOUL_EVENTS = new Set<MatchEventType>([
  MatchEventType.PERSONAL_FOUL,
  MatchEventType.TECHNICAL_FOUL,
  MatchEventType.FLAGRANT_FOUL,
]);

// ============================================================================
// CÁLCULO DE PLACAR
// ============================================================================

/**
 * Calcula o placar completo da partida a partir dos eventos.
 *
 * Filtra eventos anulados (isVoided = true) automaticamente.
 * Retorna placar total + breakdown por período.
 *
 * @param events - Array de eventos da partida (pode incluir voided)
 * @returns ScoreResult com placar total e por período
 */
export function calculateScore(events: ScoreEvent[]): ScoreResult {
  const activeEvents = events.filter((e) => !e.isVoided);

  // Placar total
  let homeScore = 0;
  let awayScore = 0;
  let homeTeamFouls = 0;
  let awayTeamFouls = 0;

  // Placar por período (Map dinâmico para suportar OT)
  const periodMap = new Map<number, { home: number; away: number }>();

  for (const event of activeEvents) {
    const points = getPointsForEventType(event.type);

    // Pontuação
    if (points > 0 && event.teamSide) {
      if (event.teamSide === TeamSide.HOME) {
        homeScore += points;
      } else {
        awayScore += points;
      }

      // Acumula no período
      if (event.period !== null) {
        const period = periodMap.get(event.period) ?? { home: 0, away: 0 };
        if (event.teamSide === TeamSide.HOME) {
          period.home += points;
        } else {
          period.away += points;
        }
        periodMap.set(event.period, period);
      }
    }

    // Faltas de equipe
    if (FOUL_EVENTS.has(event.type) && event.teamSide) {
      if (event.teamSide === TeamSide.HOME) {
        homeTeamFouls++;
      } else {
        awayTeamFouls++;
      }
    }
  }

  // Converte Map para array ordenado
  const periods: PeriodScore[] = Array.from(periodMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([periodNumber, scores]) => ({
      periodNumber,
      homeScore: scores.home,
      awayScore: scores.away,
    }));

  return {
    match: { homeScore, awayScore, homeTeamFouls, awayTeamFouls },
    periods,
  };
}

// ============================================================================
// AGREGAÇÃO DE ESTATÍSTICAS POR JOGADOR (consumido pelo stats.service.ts)
// ============================================================================

/**
 * Agrega estatísticas individuais por jogador a partir dos eventos.
 * Retorna um Map de playerId → PlayerEventStats.
 *
 * Filtra eventos anulados e ignora eventos sem playerId (controle/time).
 * Cada tipo de evento incrementa o contador correto.
 */
export function aggregatePlayerStats(
  events: ScoreEvent[],
): Map<string, PlayerEventStats> {
  const statsMap = new Map<string, PlayerEventStats>();

  const activeEvents = events.filter(
    (e) => !e.isVoided && e.playerId !== null && e.teamSide !== null,
  );

  for (const event of activeEvents) {
    const pid = event.playerId!;
    const side = event.teamSide!;

    if (!statsMap.has(pid)) {
      statsMap.set(pid, createEmptyStats(pid, side));
    }

    const stats = statsMap.get(pid)!;

    switch (event.type) {
      // --- Arremessos convertidos ---
      case MatchEventType.TWO_POINT_MADE:
        stats.points += 2;
        stats.twoPointersMade++;
        stats.twoPointersAttempted++;
        break;
      case MatchEventType.THREE_POINT_MADE:
        stats.points += 3;
        stats.threePointersMade++;
        stats.threePointersAttempted++;
        break;
      case MatchEventType.FREE_THROW_MADE:
        stats.points += 1;
        stats.freeThrowsMade++;
        stats.freeThrowsAttempted++;
        break;

      // --- Arremessos errados ---
      case MatchEventType.TWO_POINT_MISSED:
        stats.twoPointersAttempted++;
        break;
      case MatchEventType.THREE_POINT_MISSED:
        stats.threePointersAttempted++;
        break;
      case MatchEventType.FREE_THROW_MISSED:
        stats.freeThrowsAttempted++;
        break;

      // --- Rebotes ---
      case MatchEventType.REBOUND_OFFENSIVE:
        stats.offensiveRebounds++;
        break;
      case MatchEventType.REBOUND_DEFENSIVE:
        stats.defensiveRebounds++;
        break;

      // --- Defesa ---
      case MatchEventType.STEAL:
        stats.steals++;
        break;
      case MatchEventType.BLOCK:
        stats.blocks++;
        break;

      // --- Erros ---
      case MatchEventType.TURNOVER:
        stats.turnovers++;
        break;

      // --- Faltas ---
      case MatchEventType.PERSONAL_FOUL:
      case MatchEventType.TECHNICAL_FOUL:
      case MatchEventType.FLAGRANT_FOUL:
        stats.fouls++;
        break;

      // Substituições e outros: sem efeito em stats
      default:
        break;
    }
  }

  return statsMap;
}

// ============================================================================
// P-VAL (Player Value) — Fórmula de MVP
// ============================================================================

/**
 * Calcula o P-VAL de um jogador a partir das suas estatísticas agregadas.
 *
 * Fórmula:
 *   P-VAL = (Pts × ShootingEfficiency) + Blocks + KeyAssists
 *           + BuzzerBeaters + Drives + (Rebounds / 2) - Turnovers
 *
 * ShootingEfficiency = Points / FieldGoalsAttempted
 *   (null se FGA = 0 — jogador não tentou arremesso)
 *
 * Nota: KeyAssists, BuzzerBeaters e Drives não são rastreados via
 * MatchEventType padrão — são campos manuais do MatchStat. Para o
 * cálculo automático via eventos, usamos os valores disponíveis.
 * A fórmula completa com highlight stats será refinada na E3.4.
 */
export function calculatePVal(stats: PlayerEventStats): {
  shootingEfficiency: number | null;
  playerValue: number;
} {
  const totalRebounds = stats.offensiveRebounds + stats.defensiveRebounds;
  const fieldGoalsAttempted =
    stats.twoPointersAttempted + stats.threePointersAttempted;
  const fieldGoalsMade = stats.twoPointersMade + stats.threePointersMade;

  // ShootingEfficiency: null se nenhum arremesso tentado
  const shootingEfficiency =
    fieldGoalsAttempted > 0 ? stats.points / fieldGoalsAttempted : null;

  // P-VAL base (sem highlight stats manuais — serão adicionados na E3.4)
  const efficiencyComponent =
    shootingEfficiency !== null
      ? stats.points * shootingEfficiency
      : stats.points * 0.5; // Fallback conservador se não arremessou

  const playerValue =
    efficiencyComponent +
    stats.blocks +
    stats.steals +
    totalRebounds / 2 -
    stats.turnovers;

  return {
    shootingEfficiency:
      shootingEfficiency !== null
        ? Math.round(shootingEfficiency * 1000) / 1000
        : null,
    playerValue: Math.round(playerValue * 100) / 100,
  };
}

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

function createEmptyStats(
  playerId: string,
  teamSide: TeamSide,
): PlayerEventStats {
  return {
    playerId,
    teamSide,
    points: 0,
    twoPointersMade: 0,
    twoPointersAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    assists: 0,
  };
}
