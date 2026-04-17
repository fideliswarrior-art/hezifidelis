import { PlayerStatus } from "@prisma/client";

// =============================================================================
// HEZI TECH — GUARD: STATE MACHINE DE TRANSIÇÕES DE STATUS
// =============================================================================
// Arquivo: lib/security/guards/require-status-transition.ts
// Camada de Defesa: C6 (Workflow/Status)
// Artigos LGPD: Art. 6º VIII (Prevenção)
//
// PROPÓSITO:
//   Implementar state machines declarativas que definem TODAS as transições
//   de status válidas para cada entidade do sistema. Qualquer transição
//   não declarada explicitamente é PROIBIDA.
//
//   Sem este guard, transições inválidas seriam possíveis:
//     • Order DELIVERED → PENDING (reverter pedido entregue)
//     • Payment APPROVED → PENDING (reverter pagamento aprovado)
//     • Match FINISHED → LIVE (reabrir partida encerrada)
//     • Ticket USED → UNUSED (reutilizar ingresso)
//
// DESIGN:
//   Cada state machine é um Map<StatusAtual, Set<StatusesPermitidos>>.
//   A validação é O(1) — lookup no Map + check no Set.
//   Novas entidades são adicionadas registrando um novo Map.
//
// REFERÊNCIAS:
//   • Matriz de Defesa v1.0 — Camada C6
//   • Seção 12.2 — Regras de negócio críticas
//   • policy.config.json — Regras globais + Perfis de Controle
// =============================================================================

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Definição de uma state machine: mapa de status atual → status permitidos.
 *
 * Exemplo: { "SCHEDULED": ["LIVE", "CANCELED", "POSTPONED", "FORFEIT"] }
 * significa que de SCHEDULED, só pode ir para LIVE, CANCELED, POSTPONED ou FORFEIT.
 */
type TransitionMap = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Resultado da validação de transição.
 */
interface TransitionValidation {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly allowedTargets?: readonly string[];
}

/**
 * Domínios registrados com state machines.
 * Cada chave corresponde a uma entidade do schema Prisma.
 */
export type StateMachineDomain =
  | "Match"
  | "Order"
  | "Payment"
  | "Donation"
  | "Draft"
  | "PlayoffSeries"
  | "Registration"
  | "Player";

// -----------------------------------------------------------------------------
// CLASSES DE ERRO
// -----------------------------------------------------------------------------

/**
 * Erro lançado quando uma transição de status é inválida.
 *
 * Mapeado para HTTP 422 (Unprocessable Entity) pelo safe-route.ts.
 *
 * A mensagem inclui os targets válidos para facilitar debugging
 * mas NÃO inclui lógica de negócio interna.
 */
export class StatusTransitionError extends Error {
  public readonly statusCode = 422;

  constructor(
    public readonly domain: string,
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
    public readonly allowedTargets: readonly string[],
  ) {
    const allowed =
      allowedTargets.length > 0
        ? `Transições permitidas a partir de "${currentStatus}": ${allowedTargets.join(", ")}.`
        : `O status "${currentStatus}" é terminal e não permite transições.`;

    super(
      `Transição de status inválida para ${domain}. ` +
        `Não é possível alterar de "${currentStatus}" para "${attemptedStatus}". ` +
        allowed,
    );
    this.name = "StatusTransitionError";
  }
}

// -----------------------------------------------------------------------------
// STATE MACHINES — DEFINIÇÕES DECLARATIVAS
// -----------------------------------------------------------------------------
// Cada Map define TODAS as transições válidas.
// Se um status não está como chave, ele é TERMINAL (sem saída).
// Se um status não está em nenhum Set, ele é INICIAL (sem entrada direta).
//
// REGRA: Adicionar transições aqui é a ÚNICA forma de habilitar uma mudança
//        de status. O código de service NUNCA deve fazer update de status
//        sem passar por requireStatusTransition.
// -----------------------------------------------------------------------------

/**
 * STATE MACHINE: Match (Partida)
 *
 * ```
 * SCHEDULED ──→ LIVE ──→ FINISHED
 * │
 * ├──→ CANCELED
 * ├──→ POSTPONED ──→ SCHEDULED (reagendar)
 * ├──→ FORFEIT
 * │
 * LIVE ──→ CANCELED (emergência)
 * LIVE ──→ POSTPONED (interrupção — chuva, blackout)
 * ```
 *
 * Status terminais: FINISHED, CANCELED, FORFEIT.
 * POSTPONED pode retornar a SCHEDULED (reagendamento).
 */
const MATCH_TRANSITIONS: TransitionMap = new Map([
  ["SCHEDULED", new Set(["LIVE", "CANCELED", "POSTPONED", "FORFEIT"])],
  ["LIVE", new Set(["FINISHED", "CANCELED", "POSTPONED"])],
  ["POSTPONED", new Set(["SCHEDULED", "CANCELED"])],
  // FINISHED — terminal
  // CANCELED — terminal
  // FORFEIT  — terminal
]);

/**
 * STATE MACHINE: Order (Pedido)
 *
 * ```
 * PENDING ──→ PAID ──→ PROCESSING ──→ SHIPPED ──→ DELIVERED
 * │                                               │
 * ├──→ CANCELED                               REFUNDED
 * │
 * PAID ──→ CANCELED (antes do envio)
 * PAID ──→ REFUNDED (estorno imediato)
 * PROCESSING ──→ CANCELED
 * DELIVERED ──→ REFUNDED
 * ```
 *
 * REGRA: totalAmount é SEMPRE calculado server-side.
 * REGRA: PAID só ocorre via webhook HMAC (Payment.status = APPROVED).
 */
const ORDER_TRANSITIONS: TransitionMap = new Map([
  ["PENDING", new Set(["PAID", "CANCELED"])],
  ["PAID", new Set(["PROCESSING", "CANCELED", "REFUNDED"])],
  ["PROCESSING", new Set(["SHIPPED", "CANCELED"])],
  ["SHIPPED", new Set(["DELIVERED"])],
  ["DELIVERED", new Set(["REFUNDED"])],
  // CANCELED — terminal
  // REFUNDED — terminal
]);

/**
 * STATE MACHINE: Payment (Pagamento)
 *
 * ```
 * PENDING ──→ APPROVED ──→ REFUNDED
 * │
 * └──→ FAILED
 * ```
 *
 * REGRA CRÍTICA: Payment.status SOMENTE atualizado via webhook HMAC.
 * Nunca via API pública, mesmo por ADMIN.
 * (Ref: Seção 12.2 — "Payment.status — atualizado SOMENTE via webhook")
 */
const PAYMENT_TRANSITIONS: TransitionMap = new Map([
  ["PENDING", new Set(["APPROVED", "FAILED"])],
  ["APPROVED", new Set(["REFUNDED"])],
  // FAILED   — terminal
  // REFUNDED — terminal
]);

/**
 * STATE MACHINE: Donation (Doação)
 *
 * ```
 * PLEDGED ──→ RECEIVED ──→ CONFIRMED
 * ```
 *
 * REGRA: Doações físicas — ciclo controlado manualmente pelo ADMIN.
 * REGRA: Doações monetárias — CONFIRMED automático via Payment.status.
 * REGRA: AuditLog obrigatório em cada transição.
 * (Ref: Seção 12.4 — Regras de integridade financeira)
 */
const DONATION_TRANSITIONS: TransitionMap = new Map([
  ["PLEDGED", new Set(["RECEIVED", "CONFIRMED"])],
  ["RECEIVED", new Set(["CONFIRMED"])],
  // CONFIRMED — terminal
]);

/**
 * STATE MACHINE: Draft
 *
 * ```
 * UPCOMING ──→ OPEN ──→ IN_PROGRESS ──→ COMPLETED
 * ```
 *
 * REGRA: DraftPick criado SOMENTE com Draft.status = IN_PROGRESS.
 * REGRA: pickNumber gerado atomicamente no backend.
 */
const DRAFT_TRANSITIONS: TransitionMap = new Map([
  ["UPCOMING", new Set(["OPEN"])],
  ["OPEN", new Set(["IN_PROGRESS"])],
  ["IN_PROGRESS", new Set(["COMPLETED"])],
  // COMPLETED — terminal
]);

/**
 * STATE MACHINE: PlayoffSeries
 *
 * ```
 * SCHEDULED ──→ IN_PROGRESS ──→ FINISHED
 * ```
 *
 * REGRA: winnerId preenchido somente quando time atinge requiredWins.
 */
const PLAYOFF_SERIES_TRANSITIONS: TransitionMap = new Map([
  ["SCHEDULED", new Set(["IN_PROGRESS"])],
  ["IN_PROGRESS", new Set(["FINISHED"])],
  // FINISHED — terminal
]);

/**
 * STATE MACHINE: EventRegistration (Inscrição)
 *
 * ```
 * PENDING ──→ APPROVED
 * PENDING ──→ REJECTED
 * PENDING ──→ WAITLIST ──→ APPROVED
 * ──→ REJECTED
 * ```
 */
const REGISTRATION_TRANSITIONS: TransitionMap = new Map([
  ["PENDING", new Set(["APPROVED", "REJECTED", "WAITLIST"])],
  ["WAITLIST", new Set(["APPROVED", "REJECTED"])],
  // APPROVED — terminal
  // REJECTED — terminal
]);

/**
 * STATE MACHINE: Player (Jogador)
 * Regras da Matriz de Defesa v1.0 (§7.9):
 * * ```
 * ACTIVE ↔ INJURED ↔ SUSPENDED ↔ FREE_AGENT
 * ACTIVE → RETIRED
 * FREE_AGENT ← (quando contrato encerrado sem novo contrato)
 * RETIRED → [terminal]
 * ```
 */
const PLAYER_TRANSITIONS: TransitionMap = new Map([
  ["ACTIVE", new Set(["INJURED", "SUSPENDED", "FREE_AGENT", "RETIRED"])],
  ["INJURED", new Set(["ACTIVE", "SUSPENDED", "FREE_AGENT"])],
  ["SUSPENDED", new Set(["ACTIVE", "INJURED", "FREE_AGENT"])],
  ["FREE_AGENT", new Set(["ACTIVE", "INJURED", "SUSPENDED"])],
  // RETIRED — terminal
]);

// -----------------------------------------------------------------------------
// REGISTRO CENTRAL
// -----------------------------------------------------------------------------

/**
 * Registro centralizado de todas as state machines.
 *
 * Para adicionar uma nova entidade:
 * 1. Definir a TransitionMap acima.
 * 2. Adicionar ao MACHINES.
 * 3. Adicionar o domain à union type StateMachineDomain.
 */
const MACHINES: ReadonlyMap<StateMachineDomain, TransitionMap> = new Map([
  ["Match", MATCH_TRANSITIONS],
  ["Order", ORDER_TRANSITIONS],
  ["Payment", PAYMENT_TRANSITIONS],
  ["Donation", DONATION_TRANSITIONS],
  ["Draft", DRAFT_TRANSITIONS],
  ["PlayoffSeries", PLAYOFF_SERIES_TRANSITIONS],
  ["Registration", REGISTRATION_TRANSITIONS],
  ["Player", PLAYER_TRANSITIONS],
]);

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS
// -----------------------------------------------------------------------------

/**
 * Valida se uma transição de status é permitida pela state machine.
 *
 * Se a transição é inválida, lança StatusTransitionError (422).
 * Se a transição é válida, retorna silenciosamente.
 *
 * DEVE ser chamado ANTES de qualquer `db.entity.update({ status })`.
 *
 * @param domain        - Entidade do domínio (ex: "Match", "Order").
 * @param currentStatus - Status atual da entidade no banco.
 * @param targetStatus  - Status desejado (para onde quer transicionar).
 *
 * @throws StatusTransitionError se a transição não está na state machine.
 * @throws Error se o domain não tem state machine registrada.
 *
 * @example
 * ```typescript
 * // Em match.service.ts — startMatch():
 * const match = await db.match.findUniqueOrThrow({ where: { id: matchId } });
 *
 * requireStatusTransition("Match", match.status, "LIVE");
 * // Se chegou aqui, a transição é válida
 *
 * await db.match.update({
 * where: { id: matchId },
 * data: { status: "LIVE" }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Em order.service.ts — cancelOrder():
 * requireStatusTransition("Order", order.status, "CANCELED");
 * // Lança 422 se order.status = "DELIVERED" (não pode cancelar)
 * ```
 */
export function requireStatusTransition(
  domain: StateMachineDomain,
  currentStatus: string,
  targetStatus: string,
): void {
  const machine = MACHINES.get(domain);

  if (!machine) {
    throw new Error(
      `State machine não registrada para o domínio "${domain}". ` +
        `Domínios disponíveis: ${[...MACHINES.keys()].join(", ")}.`,
    );
  }

  const allowedTargets = machine.get(currentStatus);

  // Status atual é terminal (não existe como chave) → nenhuma transição permitida
  if (!allowedTargets) {
    throw new StatusTransitionError(domain, currentStatus, targetStatus, []);
  }

  // Status target não está nos permitidos
  if (!allowedTargets.has(targetStatus)) {
    throw new StatusTransitionError(domain, currentStatus, targetStatus, [
      ...allowedTargets,
    ]);
  }

  // Transição válida — retorna silenciosamente
}

/**
 * Valida transição sem lançar exceção — retorna resultado tipado.
 *
 * Útil para:
 * - Renderização condicional (mostrar/ocultar botões por status).
 * - Validação em batch (verificar múltiplas transições de uma vez).
 *
 * @example
 * ```typescript
 * const result = validateTransition("Order", order.status, "CANCELED");
 * if (!result.allowed) {
 * // Mostrar mensagem ao usuário
 * }
 * ```
 */
export function validateTransition(
  domain: StateMachineDomain,
  currentStatus: string,
  targetStatus: string,
): TransitionValidation {
  try {
    requireStatusTransition(domain, currentStatus, targetStatus);
    return { allowed: true };
  } catch (error) {
    if (error instanceof StatusTransitionError) {
      return {
        allowed: false,
        reason: error.message,
        allowedTargets: error.allowedTargets,
      };
    }
    return { allowed: false, reason: "Domínio não registrado." };
  }
}

/**
 * Retorna todos os status para os quais a entidade pode transicionar
 * a partir do status atual.
 *
 * Útil para:
 * - Montar dropdowns de "próximo status" no painel admin.
 * - Documentação automática de fluxos.
 *
 * @returns Array de status permitidos, ou array vazio se terminal.
 *
 * @example
 * ```typescript
 * const next = getAllowedTransitions("Match", "SCHEDULED");
 * // → ["LIVE", "CANCELED", "POSTPONED", "FORFEIT"]
 *
 * const terminal = getAllowedTransitions("Match", "FINISHED");
 * // → [] (status terminal)
 * ```
 */
export function getAllowedTransitions(
  domain: StateMachineDomain,
  currentStatus: string,
): readonly string[] {
  const machine = MACHINES.get(domain);
  if (!machine) return [];

  const targets = machine.get(currentStatus);
  if (!targets) return [];

  return [...targets];
}

/**
 * Verifica se um status é terminal (não permite nenhuma transição de saída).
 *
 * @example
 * ```typescript
 * isTerminalStatus("Match", "FINISHED");   // true
 * isTerminalStatus("Match", "SCHEDULED");  // false
 * isTerminalStatus("Order", "REFUNDED");   // true
 * ```
 */
export function isTerminalStatus(
  domain: StateMachineDomain,
  status: string,
): boolean {
  const machine = MACHINES.get(domain);
  if (!machine) return true;

  const targets = machine.get(status);
  return !targets || targets.size === 0;
}

/**
 * Retorna a lista de todos os domínios registrados com state machine.
 * Útil para validação e documentação.
 */
export function getRegisteredDomains(): readonly StateMachineDomain[] {
  return [...MACHINES.keys()];
}
