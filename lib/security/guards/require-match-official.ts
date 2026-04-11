// =============================================================================
// HEZI TECH — GUARD: MATCH OFFICIAL DESIGNATION
// =============================================================================
// Arquivo: lib/security/guards/require-match-official.ts
// Camada de Defesa: C4 (ABAC de Escopo), C5 (Integridade de Jogo)
// Artigos LGPD: Art. 6º VIII (Prevenção)
//
// PROPÓSITO:
//   Garantir que um usuário com papel operacional (SCOREKEEPER, REFEREE,
//   TIMEKEEPER, VOLUNTEER) só possa agir em partidas onde foi formalmente
//   designado via MatchOfficial.
//
//   Sem este guard, um SCOREKEEPER poderia registrar lances em QUALQUER
//   partida, não apenas na que lhe foi atribuída — violação da Camada C4.
//
// REGRAS DE NEGÓCIO ASSOCIADAS:
//   • MatchOfficial atribuído SOMENTE com Match.status = SCHEDULED.
//   • SCOREKEEPER/REFEREE — papel global NÃO é suficiente. Precisa estar
//     na tabela MatchOfficial designado na partida específica.
//   • ADMIN e SUPER_ADMIN fazem bypass deste guard (com AuditLog).
//   (Ref: Seção 12.3 — Regras de autorização)
//
// USO:
//   Sempre APÓS requireAuth — depende do userId da sessão.
//   Geralmente combinado com requireMatchStatus.
//
// REFERÊNCIAS:
//   • Matriz de Defesa v1.0 — Camada C4 (ABAC de Escopo)
//   • policy.config.json — CP-07 (Partidas)
// =============================================================================

import type { OfficialRole } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_HIERARCHY } from "@/lib/security/policy/roles";

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Sessão mínima necessária — compatível com o retorno de requireAuth.
 */
interface SessionContext {
  readonly userId: string;
  readonly role: string;
}

/**
 * Resultado da verificação de designação oficial.
 */
interface OfficialVerification {
  /** Se o usuário está autorizado (designado ou admin bypass). */
  readonly authorized: boolean;
  /** Se a autorização veio de bypass administrativo (para AuditLog). */
  readonly isBypass: boolean;
  /** O registro de MatchOfficial, se encontrado. */
  readonly designation: {
    readonly id: string;
    readonly role: OfficialRole;
  } | null;
}

// -----------------------------------------------------------------------------
// CLASSES DE ERRO
// -----------------------------------------------------------------------------

/**
 * Erro lançado quando o usuário não está designado como oficial na partida.
 * 
 * Mapeado para HTTP 403 pelo safe-route.ts.
 * 
 * Mensagem genérica proposital: não revela se a partida existe ou não
 * (previne enumeração de matchId).
 */
export class MatchOfficialError extends Error {
  public readonly statusCode = 403;

  constructor(
    public readonly requiredRole?: OfficialRole
  ) {
    const roleMsg = requiredRole
      ? ` com função ${requiredRole}`
      : "";
    super(`Acesso negado. Você não está designado como oficial${roleMsg} nesta partida.`);
    this.name = "MatchOfficialError";
  }
}

// -----------------------------------------------------------------------------
// CONSTANTES
// -----------------------------------------------------------------------------

/** Peso mínimo para bypass administrativo (ADMIN = 50). */
const ADMIN_BYPASS_WEIGHT = ROLE_HIERARCHY.ADMIN;

// -----------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// -----------------------------------------------------------------------------

/**
 * Verifica se o usuário está designado como oficial em uma partida específica.
 * 
 * CADEIA DE VERIFICAÇÃO:
 *   1. Se o papel do usuário ≥ ADMIN (peso 50), concede bypass.
 *      → Retorna { authorized: true, isBypass: true }.
 *      → O caller DEVE registrar no AuditLog com metadata.reason.
 *   
 *   2. Consulta MatchOfficial no banco.
 *      → Se `requiredRole` fornecido: exige match exato do OfficialRole.
 *      → Se `requiredRole` omitido: aceita qualquer designação.
 *   
 *   3. Se não encontrado → lança MatchOfficialError (403).
 * 
 * @param session      - Sessão autenticada (de requireAuth).
 * @param matchId      - ID da partida a verificar.
 * @param requiredRole - Papel operacional específico exigido (opcional).
 *                       Ex: "SCOREKEEPER" para registrar lances.
 *                       Se omitido, aceita qualquer papel em MatchOfficial.
 * 
 * @returns OfficialVerification com status de autorização.
 * @throws MatchOfficialError se não autorizado.
 * 
 * @example
 * ```typescript
 * // Em app/api/matches/[id]/events/route.ts:
 * const session = await requireAuth();
 * const official = await requireMatchOfficial(session, matchId, "SCOREKEEPER");
 * 
 * if (official.isBypass) {
 *   await createAuditLog(session.userId, "MATCH_EVENT_ADMIN_BYPASS", 
 *     "Match", matchId, null, null, ip, { reason: "Correção emergencial" });
 * }
 * ```
 */
export async function requireMatchOfficial(
  session: SessionContext,
  matchId: string,
  requiredRole?: OfficialRole
): Promise<OfficialVerification> {

  // -------------------------------------------------------------------------
  // 1. BYPASS ADMINISTRATIVO
  // -------------------------------------------------------------------------
  // ADMIN e SUPER_ADMIN podem operar em qualquer partida.
  // REGRA: superAdminBypassRequiresAudit = true (policy.config.json)
  // O caller é responsável por registrar o AuditLog com reason.
  // -------------------------------------------------------------------------
  const userWeight = ROLE_HIERARCHY[session.role as keyof typeof ROLE_HIERARCHY] ?? 0;

  if (userWeight >= ADMIN_BYPASS_WEIGHT) {
    return {
      authorized: true,
      isBypass: true,
      designation: null,
    };
  }

  // -------------------------------------------------------------------------
  // 2. CONSULTA DE DESIGNAÇÃO
  // -------------------------------------------------------------------------
  // Busca em MatchOfficial se o userId está registrado para esta partida.
  // Se requiredRole fornecido, exige match exato (SCOREKEEPER ≠ REFEREE).
  // -------------------------------------------------------------------------
  const whereClause: {
    matchId: string;
    userId: string;
    role?: OfficialRole;
  } = {
    matchId,
    userId: session.userId,
  };

  if (requiredRole) {
    whereClause.role = requiredRole;
  }

  const designation = await db.matchOfficial.findFirst({
    where: whereClause,
    select: {
      id: true,
      role: true,
    },
  });

  // -------------------------------------------------------------------------
  // 3. RESULTADO
  // -------------------------------------------------------------------------
  if (!designation) {
    throw new MatchOfficialError(requiredRole);
  }

  return {
    authorized: true,
    isBypass: false,
    designation: {
      id: designation.id,
      role: designation.role,
    },
  };
}

/**
 * Verifica designação sem lançar exceção — retorna boolean.
 * 
 * Útil para renderização condicional no frontend (Server Components)
 * onde um 403 não faz sentido.
 * 
 * @example
 * ```typescript
 * // Em um Server Component:
 * const canOperate = await isMatchOfficial(session, matchId, "SCOREKEEPER");
 * // Renderizar botão de scorebook apenas se true
 * ```
 */
export async function isMatchOfficial(
  session: SessionContext,
  matchId: string,
  requiredRole?: OfficialRole
): Promise<boolean> {
  try {
    const result = await requireMatchOfficial(session, matchId, requiredRole);
    return result.authorized;
  } catch {
    return false;
  }
}