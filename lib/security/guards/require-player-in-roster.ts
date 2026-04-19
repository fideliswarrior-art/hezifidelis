/**
 * ============================================================================
 * HEZI TECH — GUARD DE ELENCO (Onda 3 - E3.3)
 * ============================================================================
 * Arquivo: lib/security/guards/require-player-in-roster.ts
 * Camada de Defesa: C4 (ABAC de escopo) + C5 (Integridade de Jogo)
 *
 * PROPÓSITO:
 * Verificar que um jogador está inscrito no RosterSnapshot do Split
 * antes de permitir que o mesário registre MatchEvents para ele.
 *
 * SEM ESTE GUARD:
 * Um mesário (ou admin com bypass) poderia registrar pontos para um
 * jogador que não pertence a nenhum dos dois times da partida, ou que
 * foi transferido para outro time após a geração do snapshot.
 *
 * INTEGRAÇÃO:
 *   - Consumido por match-event.service.ts no registerEvent
 *   - Depende de roster.service.ts ter gerado o snapshot antes
 *   - Retorna a entrada do roster para que o caller valide teamSide
 *
 * FLUXO:
 *   1. Caller resolve o splitId a partir do Match (via Phase)
 *   2. Guard busca RosterSnapshot por (splitId, playerId)
 *   3. Se não existe → PlayerNotInRosterError (422)
 *   4. Se existe → retorna { teamId, jerseyNumber, position }
 *   5. Caller verifica se teamId bate com HOME ou AWAY da partida
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { Position } from "@prisma/client";

// ============================================================================
// CLASSE DE ERRO
// ============================================================================

export class PlayerNotInRosterError extends Error {
  public readonly statusCode = 422;
  public readonly code = "PLAYER_NOT_IN_ROSTER";

  constructor(playerId: string, splitId: string) {
    super(
      "O jogador não está inscrito no elenco deste torneio. " +
        "Verifique se o RosterSnapshot foi gerado e se o jogador possui contrato ativo neste Split.",
    );
    this.name = "PlayerNotInRosterError";
  }
}

// ============================================================================
// TIPO DE RETORNO
// ============================================================================

export interface RosterEntry {
  playerId: string;
  teamId: string;
  jerseyNumber: number;
  position: Position;
}

// ============================================================================
// GUARD
// ============================================================================

/**
 * Verifica que o jogador está no RosterSnapshot do Split.
 *
 * @param playerId — ID do jogador no evento
 * @param splitId — ID do Split (resolvido pelo caller via Match → Phase → Split)
 * @returns RosterEntry com teamId, jerseyNumber e position
 * @throws PlayerNotInRosterError se o jogador não estiver no snapshot
 */
export async function requirePlayerInRoster(
  playerId: string,
  splitId: string,
): Promise<RosterEntry> {
  const entry = await db.rosterSnapshot.findUnique({
    where: {
      splitId_playerId: { splitId, playerId },
    },
    select: {
      playerId: true,
      teamId: true,
      jerseyNumber: true,
      position: true,
    },
  });

  if (!entry) {
    throw new PlayerNotInRosterError(playerId, splitId);
  }

  return entry;
}

/**
 * Helper para resolver o splitId de uma partida.
 *
 * Match → Phase → Split. Se a partida não tem phaseId (edge case de
 * dados inconsistentes), lança erro genérico.
 *
 * Usado pelo match-event.service.ts para não repetir esta query.
 */
export async function resolveSplitIdFromMatch(
  matchId: string,
): Promise<string> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      phase: { select: { splitId: true } },
      group: { select: { phase: { select: { splitId: true } } } },
    },
  });

  if (!match) {
    throw new Error("Partida não encontrada.");
  }

  // Match pode estar vinculado via phase direta ou via group → phase
  const splitId = match.phase?.splitId ?? match.group?.phase?.splitId ?? null;

  if (!splitId) {
    throw new Error(
      "Não foi possível resolver o Split desta partida. Verifique a vinculação com Phase/Group.",
    );
  }

  return splitId;
}
