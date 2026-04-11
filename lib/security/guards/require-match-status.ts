// =============================================================================
// HEZI TECH — GUARD: MATCH STATUS VALIDATION
// =============================================================================
// Arquivo: lib/security/guards/require-match-status.ts
// Camada de Defesa: C5 (Integridade de Jogo), C6 (Workflow/Status)
// Artigos LGPD: Art. 6º VIII (Prevenção)
//
// PROPÓSITO:
//   Garantir que operações sobre partidas só ocorram quando o Match.status
//   está no estado correto. Sem este guard:
//     • Um mesário poderia registrar lances em partida SCHEDULED (não iniciada).
//     • Um árbitro poderia ser atribuído a uma partida já LIVE.
//     • Eventos poderiam ser criados em partidas CANCELED.
//
// REGRAS DE NEGÓCIO ASSOCIADAS:
//   • MatchEvent criado SOMENTE com Match.status = LIVE.
//   • MatchOfficial atribuído SOMENTE com Match.status = SCHEDULED.
//   • Partida finalizada (FINISHED) é imutável para eventos de jogo.
//   (Ref: Seção 12.2 — Regras de negócio críticas)
//
// USO:
//   Geralmente combinado com requireMatchOfficial.
//   Chamado ANTES de qualquer mutação no contexto de partida.
//
// REFERÊNCIAS:
//   • Matriz de Defesa v1.0 — Camadas C5 e C6
//   • policy.config.json — CP-07 (Partidas)
// =============================================================================

import type { MatchStatus } from "@prisma/client";
import { db } from "@/lib/db";

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Dados retornados quando o status é válido.
 * Inclui campos frequentemente necessários pelo caller, evitando
 * uma segunda query ao banco.
 */
interface MatchContext {
  readonly id: string;
  readonly status: MatchStatus;
  readonly format: string;
  readonly isOfficial: boolean;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeScore: number;
  readonly awayScore: number;
}

// -----------------------------------------------------------------------------
// CLASSES DE ERRO
// -----------------------------------------------------------------------------

/**
 * Erro lançado quando a partida não está no status esperado.
 * 
 * Mapeado para HTTP 422 (Unprocessable Entity) pelo safe-route.ts.
 * 422 é mais semântico que 400 aqui: os dados são válidos, mas a
 * operação não pode ser processada no estado atual da entidade.
 */
export class MatchStatusError extends Error {
  public readonly statusCode = 422;

  constructor(
    public readonly matchId: string,
    public readonly currentStatus: MatchStatus,
    public readonly expectedStatuses: readonly MatchStatus[]
  ) {
    const expected = expectedStatuses.join(" ou ");
    super(
      `Operação não permitida. A partida está com status "${currentStatus}", ` +
      `mas o status esperado é "${expected}".`
    );
    this.name = "MatchStatusError";
  }
}

/**
 * Erro lançado quando a partida não é encontrada.
 * 
 * Mapeado para HTTP 404.
 * Mensagem genérica para não revelar se o ID é válido vs. inexistente
 * (previne enumeração de matchId).
 */
export class MatchNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor() {
    super("Partida não encontrada.");
    this.name = "MatchNotFoundError";
  }
}

// -----------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// -----------------------------------------------------------------------------

/**
 * Verifica se a partida existe e está em um dos status esperados.
 * 
 * FLUXO:
 *   1. Busca a partida no banco por ID.
 *   2. Se não existe → lança MatchNotFoundError (404).
 *   3. Se status não está na lista → lança MatchStatusError (422).
 *   4. Retorna MatchContext com dados úteis para o caller.
 * 
 * @param matchId          - ID da partida (UUID do path param).
 * @param expectedStatuses - Array de status permitidos para a operação.
 *                           Usar array para operações que aceitam múltiplos
 *                           estados (ex: cancel aceita SCHEDULED e LIVE).
 * 
 * @returns MatchContext com dados da partida.
 * @throws MatchNotFoundError se a partida não existe.
 * @throws MatchStatusError se o status atual não está na lista esperada.
 * 
 * @example
 * ```typescript
 * // Registrar lance — SOMENTE com partida LIVE:
 * const match = await requireMatchStatus(matchId, ["LIVE"]);
 * 
 * // Atribuir árbitro — SOMENTE com partida SCHEDULED:
 * const match = await requireMatchStatus(matchId, ["SCHEDULED"]);
 * 
 * // Cancelar partida — SCHEDULED ou LIVE:
 * const match = await requireMatchStatus(matchId, ["SCHEDULED", "LIVE"]);
 * 
 * // Adiar partida — SCHEDULED ou LIVE:
 * const match = await requireMatchStatus(matchId, ["SCHEDULED", "LIVE"]);
 * ```
 */
export async function requireMatchStatus(
  matchId: string,
  expectedStatuses: readonly MatchStatus[]
): Promise<MatchContext> {

  // -------------------------------------------------------------------------
  // 1. BUSCA NO BANCO
  // -------------------------------------------------------------------------
  // Select mínimo com dados frequentemente usados downstream,
  // evitando query adicional no caller.
  // -------------------------------------------------------------------------
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      format: true,
      isOfficial: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  });

  // -------------------------------------------------------------------------
  // 2. EXISTÊNCIA
  // -------------------------------------------------------------------------
  if (!match) {
    throw new MatchNotFoundError();
  }

  // -------------------------------------------------------------------------
  // 3. VALIDAÇÃO DE STATUS
  // -------------------------------------------------------------------------
  if (!expectedStatuses.includes(match.status)) {
    throw new MatchStatusError(matchId, match.status, expectedStatuses);
  }

  // -------------------------------------------------------------------------
  // 4. RETORNO
  // -------------------------------------------------------------------------
  return {
    id: match.id,
    status: match.status,
    format: match.format,
    isOfficial: match.isOfficial,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
  };
}

// -----------------------------------------------------------------------------
// HELPERS DE CONVENIÊNCIA
// -----------------------------------------------------------------------------
// Wrappers semânticos que deixam o código do caller mais legível.
// Cada um documenta qual operação precisa de qual status.
// -----------------------------------------------------------------------------

/**
 * Partida deve estar LIVE para registrar eventos de jogo.
 * Usado pelo scorebook digital (mesário) e pelo árbitro.
 */
export async function requireMatchLive(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["LIVE"]);
}

/**
 * Partida deve estar SCHEDULED para atribuir oficiais.
 * Não faz sentido designar árbitro para partida já em andamento.
 */
export async function requireMatchScheduled(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["SCHEDULED"]);
}

/**
 * Partida deve estar SCHEDULED para ser iniciada (transição → LIVE).
 */
export async function requireMatchReadyToStart(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["SCHEDULED"]);
}

/**
 * Partida deve estar LIVE para ser finalizada (transição → FINISHED).
 */
export async function requireMatchReadyToFinish(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["LIVE"]);
}

/**
 * Partida deve estar SCHEDULED ou LIVE para ser cancelada.
 * Partidas FINISHED, CANCELED ou FORFEIT não podem ser canceladas.
 */
export async function requireMatchCancelable(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["SCHEDULED", "LIVE"]);
}

/**
 * Partida deve estar SCHEDULED ou LIVE para ser adiada.
 */
export async function requireMatchPostponable(matchId: string): Promise<MatchContext> {
  return requireMatchStatus(matchId, ["SCHEDULED", "LIVE"]);
}