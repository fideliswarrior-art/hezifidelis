/**
 * ============================================================================
 * HEZI TECH — GUARD DE ESTADO DA LIGA (Onda 3 - E3.1 / DT-006)
 * ============================================================================
 * Arquivo: lib/security/guards/require-league-state.ts
 * Camada de Defesa: C6 (Workflow/Status)
 *
 * PROPÓSITO:
 * Validar que uma Season ou Split existe e está ativa antes de permitir
 * operações que dependem de contexto de liga válido (criar Match, gerar
 * RosterSnapshot, registrar MatchEvent, check-in, etc.).
 *
 * DESIGN (Multi-Ativo):
 * A plataforma suporta múltiplos torneios simultâneos. Por isso, o guard
 * exige IDs explícitos em vez de buscar "a única Season/Split ativa".
 * Cada operação deve saber em qual torneio está operando.
 *
 * CONSUMIDORES PREVISTOS:
 *   - E3.3: match.service.ts (createMatch, startMatch)
 *   - E3.3.5: check-in service
 *   - E3.2: roster.service.ts (generateRosterSnapshot) — já valida inline,
 *           mas pode migrar pra cá no futuro.
 *
 * CONVENÇÃO:
 * Retorna a entidade validada (Season ou Split) para que o caller
 * possa usar os dados sem query adicional.
 * ============================================================================
 */

import { db } from "@/lib/db";

// ============================================================================
// CLASSE DE ERRO
// ============================================================================

export class LeagueStateError extends Error {
  public readonly statusCode = 422;
  public readonly code: string;

  constructor(message: string, code = "LEAGUE_STATE_INVALID") {
    super(message);
    this.name = "LeagueStateError";
    this.code = code;
  }
}

// ============================================================================
// TIPOS DE RETORNO
// ============================================================================

export interface ActiveSeason {
  id: string;
  name: string;
  slug: string;
  shortCode: string;
  year: number;
}

export interface ActiveSplit {
  id: string;
  name: string;
  seasonId: string;
  isActive: boolean;
  season: ActiveSeason;
}

// ============================================================================
// GUARDS
// ============================================================================

/**
 * Valida que a Season existe e está ativa.
 * Retorna a Season com campos essenciais para uso downstream.
 *
 * @throws LeagueStateError("SEASON_NOT_FOUND") — Season não existe
 * @throws LeagueStateError("SEASON_NOT_ACTIVE") — Season existe mas inativa
 */
export async function requireActiveSeason(
  seasonId: string,
): Promise<ActiveSeason> {
  const season = await db.season.findUnique({
    where: { id: seasonId },
    select: {
      id: true,
      name: true,
      slug: true,
      shortCode: true,
      year: true,
      isActive: true,
    },
  });

  if (!season) {
    throw new LeagueStateError("Season não encontrada.", "SEASON_NOT_FOUND");
  }

  if (!season.isActive) {
    throw new LeagueStateError(
      `A season "${season.name}" não está ativa.`,
      "SEASON_NOT_ACTIVE",
    );
  }

  return season;
}

/**
 * Valida que o Split existe e está ativo.
 * Também valida que a Season pai está ativa (proteção transitiva).
 * Retorna o Split com a Season incluída para uso downstream
 * (ex: season.shortCode para geração de contractCode).
 *
 * @throws LeagueStateError("SPLIT_NOT_FOUND") — Split não existe
 * @throws LeagueStateError("SPLIT_NOT_ACTIVE") — Split existe mas inativo
 * @throws LeagueStateError("SEASON_NOT_ACTIVE") — Season pai inativa
 */
export async function requireActiveSplit(
  splitId: string,
): Promise<ActiveSplit> {
  const split = await db.split.findUnique({
    where: { id: splitId },
    select: {
      id: true,
      name: true,
      seasonId: true,
      isActive: true,
      season: {
        select: {
          id: true,
          name: true,
          slug: true,
          shortCode: true,
          year: true,
          isActive: true,
        },
      },
    },
  });

  if (!split) {
    throw new LeagueStateError("Split não encontrado.", "SPLIT_NOT_FOUND");
  }

  if (!split.isActive) {
    throw new LeagueStateError(
      `O split "${split.name}" não está ativo.`,
      "SPLIT_NOT_ACTIVE",
    );
  }

  if (!split.season.isActive) {
    throw new LeagueStateError(
      `A season "${split.season.name}" (pai do split "${split.name}") não está ativa.`,
      "SEASON_NOT_ACTIVE",
    );
  }

  return split;
}
