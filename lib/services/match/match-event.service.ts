/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE EVENTOS DE PARTIDA / SCOREBOOK (Onda 3 - E3.3)
 * ============================================================================
 * Arquivo: lib/services/match/match-event.service.ts
 * Camada de Defesa: C4 (ABAC) + C5 (Integridade de Jogo) + C6 (Workflow) + C12 (Auditoria)
 *
 * RESPONSABILIDADE:
 * Registrar lances ao vivo (MatchEvent) durante uma partida LIVE,
 * anular lances errôneos (soft-delete via isVoided), e recalcular
 * o placar em tempo real.
 *
 * INTEGRIDADE DE JOGO (C5):
 *   - O campo `value` (pontos) é derivado server-side pelo score-calculator.
 *   - O placar (Match + MatchPeriod) é recalculado a cada evento de
 *     pontuação ou anulação — NUNCA aceito do client.
 *   - O jogador DEVE estar no RosterSnapshot do Split (requirePlayerInRoster).
 *   - O teamSide do evento DEVE corresponder ao time do jogador na partida.
 *
 * AUDITORIA SELETIVA (Planejamento §2.3.6):
 *   - registerEvent: NÃO gera AuditLog individual (200+ eventos por partida
 *     inflariam o log). A integridade é garantida pelo MatchEvent imutável.
 *   - voidEvent: SIM gera AuditLog (é ação sensível — altera placar).
 *
 * PERÍODOS:
 *   - Período 1 é criado no startMatch (match.service.ts).
 *   - Eventos PERIOD_START criam novos MatchPeriods automaticamente.
 *   - Placar por período é recalculado a cada evento de pontuação.
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { Prisma, MatchEvent } from "@prisma/client";
import { MatchStatus, MatchEventType, TeamSide } from "@prisma/client";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  calculateScore,
  getPointsForEventType,
  type ScoreEvent,
} from "@/lib/services/match/score-calculator";
import {
  requirePlayerInRoster,
  resolveSplitIdFromMatch,
} from "@/lib/security/guards/require-player-in-roster";
import {
  SCORING_EVENTS,
  PLAYER_EVENTS,
  CONTROL_EVENTS,
  type RegisterEventInput,
} from "@/lib/security/utils/validations.match";
import { sanitizePlainText } from "@/lib/security/content/sanitize";

// ============================================================================
// TIPOS
// ============================================================================

export interface ActorContext {
  userId: string;
  role: string;
  ip?: string | null;
}

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

/**
 * Carrega a partida e valida que está LIVE.
 * Retorna dados essenciais para validações downstream.
 */
async function loadLiveMatch(matchId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      phaseId: true,
      groupId: true,
    },
  });

  if (!match) throw new NotFoundError("Partida não encontrada.");

  if (match.status !== MatchStatus.LIVE) {
    throw Object.assign(
      new Error("Eventos só podem ser registrados em partidas ao vivo (LIVE)."),
      { statusCode: 422, code: "MATCH_NOT_LIVE" },
    );
  }

  return match;
}

/**
 * Recalcula e materializa o placar da partida e dos períodos.
 *
 * Chamado após registerEvent (se pontuação/falta) e após voidEvent.
 * Usa calculateScore (função pura) e atualiza banco atomicamente.
 *
 * @param matchId — ID da partida
 * @param tx — Transaction client
 */
async function recalculateAndPersistScore(
  matchId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  // 1. Busca TODOS os eventos (incluindo voided — calculateScore filtra)
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

  // 2. Calcula placar (função pura)
  const result = calculateScore(events as ScoreEvent[]);

  // 3. Atualiza Match
  await tx.match.update({
    where: { id: matchId },
    data: {
      homeScore: result.match.homeScore,
      awayScore: result.match.awayScore,
      homeTeamFouls: result.match.homeTeamFouls,
      awayTeamFouls: result.match.awayTeamFouls,
    },
  });

  // 4. Atualiza MatchPeriods
  for (const period of result.periods) {
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
}

/**
 * Resolve o teamSide de um jogador numa partida.
 * Verifica que o jogador pertence a um dos dois times.
 *
 * @returns O TeamSide correto (HOME ou AWAY)
 * @throws Error se o jogador não pertence a nenhum dos times
 */
function resolvePlayerTeamSide(
  playerTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
): TeamSide {
  if (playerTeamId === homeTeamId) return TeamSide.HOME;
  if (playerTeamId === awayTeamId) return TeamSide.AWAY;

  throw Object.assign(
    new Error("O jogador não pertence a nenhum dos times desta partida."),
    { statusCode: 422, code: "PLAYER_NOT_IN_MATCH" },
  );
}

// ============================================================================
// 1. REGISTER EVENT (Lance ao vivo)
// ============================================================================

/**
 * Registra um evento de jogo (lance ao vivo).
 *
 * Fluxo:
 *   1. Valida partida LIVE
 *   2. Se evento de jogador: valida no RosterSnapshot + teamSide correto
 *   3. Se PERIOD_START: cria novo MatchPeriod
 *   4. Deriva value (pontos) server-side
 *   5. Cria MatchEvent
 *   6. Se pontuação ou falta: recalcula placar
 *
 * SEM AuditLog individual — ver header do arquivo.
 *
 * @param matchId — ID da partida (do path param, não do body)
 * @param input — Dados do evento (validados pelo Zod)
 * @param actor — Contexto do mesário/admin
 */
export async function registerEvent(
  matchId: string,
  input: RegisterEventInput,
  actor: ActorContext,
): Promise<MatchEvent> {
  const match = await loadLiveMatch(matchId);

  // ── Validação de jogador (se aplicável) ─────────────────────
  let validatedTeamSide = input.teamSide ?? null;

  if (PLAYER_EVENTS.has(input.type) && input.playerId) {
    // 1. Resolve splitId da partida
    const splitId = await resolveSplitIdFromMatch(matchId);

    // 2. Verifica jogador no RosterSnapshot
    const rosterEntry = await requirePlayerInRoster(input.playerId, splitId);

    // 3. Verifica que o time do jogador bate com um dos times da partida
    const expectedSide = resolvePlayerTeamSide(
      rosterEntry.teamId,
      match.homeTeamId,
      match.awayTeamId,
    );

    // 4. Valida que o teamSide informado corresponde ao time real do jogador
    if (validatedTeamSide && validatedTeamSide !== expectedSide) {
      throw Object.assign(
        new Error(
          `O jogador pertence ao time ${expectedSide}, mas o evento informa ${validatedTeamSide}.`,
        ),
        { statusCode: 422, code: "TEAM_SIDE_MISMATCH" },
      );
    }

    validatedTeamSide = expectedSide;
  }

  // ── Criação do evento + recálculo ───────────────────────────
  const created = await db.$transaction(async (tx) => {
    // Se PERIOD_START: cria o novo período
    if (
      input.type === MatchEventType.PERIOD_START &&
      input.period !== undefined
    ) {
      // Upsert para idempotência (mesário pode registrar PERIOD_START duas vezes)
      await tx.matchPeriod.upsert({
        where: {
          matchId_periodNumber: {
            matchId,
            periodNumber: input.period,
          },
        },
        update: {},
        create: {
          matchId,
          periodNumber: input.period,
          homeScore: 0,
          awayScore: 0,
        },
      });
    }

    // Deriva pontos server-side (C5 — nunca do client)
    const value = getPointsForEventType(input.type);

    // Cria o evento
    const event = await tx.matchEvent.create({
      data: {
        matchId,
        type: input.type,
        teamSide: validatedTeamSide,
        playerId: input.playerId ?? null,
        period: input.period ?? null,
        gameClockMs: input.gameClockMs ?? null,
        value: value > 0 ? value : null,
        note: input.note ? sanitizePlainText(input.note, 500) : null,
        recordedById: actor.userId,
        isVoided: false,
      },
    });

    // Recalcula placar se evento afeta o score ou faltas
    if (SCORING_EVENTS.has(input.type) || isFoulEvent(input.type)) {
      await recalculateAndPersistScore(matchId, tx);
    }

    return event;
  });

  return created;
}

// ============================================================================
// 2. VOID EVENT (Anulação)
// ============================================================================

/**
 * Anula um evento de jogo (soft-delete).
 *
 * Regras:
 *   - Partida DEVE estar LIVE
 *   - Evento não pode já estar anulado (409)
 *   - Autorização: criador do evento OU ADMIN+
 *   - voidReason obrigatório (min 10 chars — validado pelo Zod)
 *   - Recalcula placar ignorando o evento anulado
 *   - SIM gera AuditLog (ação sensível)
 *
 * @param matchId — ID da partida
 * @param eventId — ID do evento a anular
 * @param voidReason — Motivo da anulação
 * @param actor — Contexto do mesário/admin
 */
export async function voidEvent(
  matchId: string,
  eventId: string,
  voidReason: string,
  actor: ActorContext,
): Promise<MatchEvent> {
  // 1. Valida partida LIVE
  await loadLiveMatch(matchId);

  // 2. Busca o evento
  const event = await db.matchEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      matchId: true,
      type: true,
      teamSide: true,
      playerId: true,
      period: true,
      value: true,
      isVoided: true,
      recordedById: true,
    },
  });

  if (!event) throw new NotFoundError("Evento não encontrado.");

  // Validar que o evento pertence a esta partida
  if (event.matchId !== matchId) {
    throw Object.assign(new Error("O evento não pertence a esta partida."), {
      statusCode: 422,
      code: "EVENT_MATCH_MISMATCH",
    });
  }

  // Já anulado?
  if (event.isVoided) {
    throw Object.assign(new Error("Este evento já foi anulado."), {
      statusCode: 409,
      code: "EVENT_ALREADY_VOIDED",
    });
  }

  // 3. Autorização: criador OU ADMIN+ (ADMIN+ verificado na rota)
  // Se não é admin (verificado no handler da rota via isBypass),
  // deve ser o próprio criador
  if (
    actor.role !== "ADMIN" &&
    actor.role !== "SUPER_ADMIN" &&
    event.recordedById !== actor.userId
  ) {
    throw Object.assign(
      new Error(
        "Apenas o criador do evento ou um administrador pode anulá-lo.",
      ),
      { statusCode: 403, code: "VOID_NOT_AUTHORIZED" },
    );
  }

  // 4. Anulação + recálculo atômicos
  const voided = await db.$transaction(async (tx) => {
    const now = new Date();

    const updated = await tx.matchEvent.update({
      where: { id: eventId },
      data: {
        isVoided: true,
        voidedAt: now,
        voidedById: actor.userId,
        voidReason: sanitizePlainText(voidReason, 500),
      },
    });

    // Recalcula placar (a função filtra eventos voided automaticamente)
    await recalculateAndPersistScore(matchId, tx);

    // AuditLog (voidEvent É auditado — diferente do registerEvent)
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.MATCH_EVENT_VOID,
        entity: "MatchEvent",
        entityId: eventId,
        before: {
          type: event.type,
          teamSide: event.teamSide,
          playerId: event.playerId,
          period: event.period,
          value: event.value,
          isVoided: false,
        },
        after: {
          isVoided: true,
          voidReason,
          voidedById: actor.userId,
        },
        ip: actor.ip ?? null,
        metadata: { matchId },
      },
    });

    return updated;
  });

  return voided;
}

// ============================================================================
// 3. LIST EVENTS (Leitura)
// ============================================================================

/**
 * Lista todos os eventos de uma partida em ordem cronológica.
 *
 * Opções:
 *   - includeVoided: false (default) — filtra anulados
 *   - includeVoided: true — mostra todos (admin debug)
 */
export async function getEventsForMatch(
  matchId: string,
  options: { includeVoided?: boolean } = {},
) {
  const { includeVoided = false } = options;

  const where: Prisma.MatchEventWhereInput = {
    matchId,
    ...(!includeVoided && { isVoided: false }),
  };

  return db.matchEvent.findMany({
    where,
    orderBy: [{ period: "asc" }, { gameClockMs: "asc" }, { createdAt: "asc" }],
    include: {
      player: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nickname: true,
        },
      },
      recordedBy: {
        select: { id: true, name: true },
      },
      voidedBy: {
        select: { id: true, name: true },
      },
    },
  });
}

// ============================================================================
// HELPERS DE TIPO
// ============================================================================

const FOUL_EVENT_TYPES = new Set<MatchEventType>([
  MatchEventType.PERSONAL_FOUL,
  MatchEventType.TECHNICAL_FOUL,
  MatchEventType.FLAGRANT_FOUL,
]);

function isFoulEvent(type: MatchEventType): boolean {
  return FOUL_EVENT_TYPES.has(type);
}
