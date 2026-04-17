import { db } from "@/lib/db";
import type { Prisma, Split } from "@prisma/client";
import { MatchStatus } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { sanitizePlainText } from "@/lib/security/content/sanitize";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  type ActorContext,
  LeagueConflictError,
} from "@/lib/services/league/season.service";
import type {
  CreateSplitInput,
  UpdateSplitInput,
  ListSplitsQuery,
} from "@/lib/security/utils/validations.league";

/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE SPLIT (Onda 3 - E3.1)
 * ============================================================================
 * Arquivo: lib/services/league/split.service.ts
 * Camada de Defesa: C3 (RBAC) + C6 (Workflow) + C12 (Observabilidade)
 *
 * RESPONSABILIDADE:
 * CRUD completo de Split (etapa dentro de uma Season/Torneio) suportando
 * MÚLTIPLOS SPLITS ATIVOS SIMULTÂNEOS — coerente com a arquitetura de
 * múltiplos torneios em paralelo da plataforma comunitária.
 *
 * EXEMPLOS DE SPLITS SIMULTÂNEOS:
 *   - "Fase de Grupos Masculina" + "Fase de Grupos Feminina" (mesma Season)
 *   - "Liga Principal" + "Copa de Inverno" (splits paralelos)
 *   - "Playoffs" + "Amistoso de Aquecimento" (fins diferentes)
 *
 * REGRAS CRÍTICAS:
 *   1. Nenhum método aceita `isActive` como parâmetro direto.
 *      Ativação/desativação só via activateSplit() / deactivateSplit().
 *
 *   2. `seasonId` é IMUTÁVEL após criação (Zod bloqueia). Split não migra.
 *
 *   3. deactivateSplit() bloqueia se houver Match LIVE naquele split
 *      (integridade — não interrompe partida em andamento).
 *
 *   4. deleteSplit() é HARD DELETE restrito a SUPER_ADMIN e só para splits
 *      sem dependentes.
 *
 *   5. Alteração de `defaultFormat` com Match já vinculado → WARNING no
 *      AuditLog mas não bloqueia. Matches existentes mantêm seu próprio
 *      Match.format individual.
 *
 *   6. Reutilização: `ActorContext` e `LeagueConflictError` vêm de
 *      season.service.ts.
 *
 * DETALHE TÉCNICO CRÍTICO:
 *   O model Split NÃO possui relação direta com Match no schema Prisma.
 *   Matches ligam-se a Phase, e Phase liga-se a Split. Para contar/verificar
 *   matches de um split, sempre fazer traversal via `phase.splitId`.
 * ============================================================================
 */

// ============================================================================
// HELPERS INTERNOS (não exportados)
// ============================================================================

/**
 * Snapshot padronizado de Split para AuditLog.
 */
function splitSnapshot(s: Split) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    defaultFormat: s.defaultFormat,
    seasonId: s.seasonId,
    isActive: s.isActive,
    startDate: s.startDate.toISOString(),
    endDate: s.endDate ? s.endDate.toISOString() : null,
  };
}

/**
 * Valida que a Season referenciada existe.
 * Chamado no create. No update, seasonId é imutável (Zod bloqueia).
 */
async function assertSeasonExists(seasonId: string): Promise<void> {
  const season = await db.season.findUnique({
    where: { id: seasonId },
    select: { id: true },
  });
  if (!season) {
    throw new NotFoundError(`Season não encontrada (id: ${seasonId}).`);
  }
}

/**
 * Conta quantos matches existem em um split via traversal Phase.
 * Match não tem FK direta para Split — relação é Match → Phase → Split.
 */
async function countMatchesInSplit(splitId: string): Promise<number> {
  return db.match.count({
    where: {
      phase: { splitId },
    },
  });
}

/**
 * Conta quantos matches com status específico existem em um split.
 */
async function countMatchesInSplitByStatus(
  splitId: string,
  status: MatchStatus,
): Promise<number> {
  return db.match.count({
    where: {
      status,
      phase: { splitId },
    },
  });
}

// ============================================================================
// 1. CREATE
// ============================================================================

/**
 * Cria um novo Split dentro de uma Season.
 *
 * Regras de negócio:
 *   - Split NUNCA nasce com isActive = true.
 *   - A Season pai DEVE existir.
 *   - Não exigimos que a Season esteja ativa — permite planejamento
 *     antecipado de splits para torneios futuros.
 *   - `description` é sanitizada via sanitizePlainText (E2.2).
 *   - `rulesUrl` já foi validada como HTTP(S) pelo Zod.
 */
export async function createSplit(
  input: CreateSplitInput,
  actor: ActorContext,
): Promise<Split> {
  await assertSeasonExists(input.seasonId);

  const created = await db.split.create({
    data: {
      name: input.name,
      type: input.type,
      defaultFormat: input.defaultFormat,
      seasonId: input.seasonId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      description: input.description
        ? sanitizePlainText(input.description, 2000)
        : null,
      rulesUrl: input.rulesUrl ?? null,
      isActive: false, // SEMPRE false na criação — regra inegociável
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SPLIT_CREATE,
    entity: "Split",
    entityId: created.id,
    before: null,
    after: splitSnapshot(created),
    ip: actor.ip ?? null,
    metadata: { seasonId: created.seasonId },
  });

  return created;
}

// ============================================================================
// 2. UPDATE (metadados — não mexe em isActive nem seasonId)
// ============================================================================

/**
 * Atualiza metadados de um Split.
 *
 * Regras:
 *   - `isActive` NÃO é editável aqui (Zod bloqueia; defesa em profundidade).
 *   - `seasonId` NÃO é editável aqui (Zod bloqueia; split não migra).
 *   - Alterar `defaultFormat` com Match já vinculado gera WARNING no AuditLog.
 *     Matches existentes mantêm seu Match.format individual (inalterado).
 *   - Alterar `type` gera WARNING (afeta regulamento implícito).
 *
 * Otimização:
 *   - A contagem de matches só é feita quando `defaultFormat` é realmente
 *     alterado. Evita query desnecessária nos updates de nome/datas/etc.
 */
export async function updateSplit(
  id: string,
  patch: UpdateSplitInput,
  actor: ActorContext,
): Promise<Split> {
  const current = await db.split.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Split não encontrado.");
  }

  // Monta data respeitando exactOptionalPropertyTypes
  const data: Prisma.SplitUpdateInput = {};

  if (patch.name !== undefined) data.name = patch.name;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.defaultFormat !== undefined)
    data.defaultFormat = patch.defaultFormat;
  if (patch.startDate !== undefined) data.startDate = patch.startDate;
  if (patch.endDate !== undefined) data.endDate = patch.endDate ?? null;
  if (patch.description !== undefined) {
    data.description = patch.description
      ? sanitizePlainText(patch.description, 2000)
      : null;
  }
  if (patch.rulesUrl !== undefined) data.rulesUrl = patch.rulesUrl ?? null;

  // Detecta mudanças sensíveis que afetam o domínio
  const warnings: string[] = [];

  // Verifica matches apenas se defaultFormat mudou (otimização)
  if (
    patch.defaultFormat !== undefined &&
    patch.defaultFormat !== current.defaultFormat
  ) {
    const matchCount = await countMatchesInSplit(id);
    if (matchCount > 0) {
      warnings.push(
        `defaultFormat alterado de ${current.defaultFormat} para ${patch.defaultFormat} em split com ${matchCount} partida(s) existente(s). Partidas existentes mantêm seu Match.format individual.`,
      );
    }
  }

  if (patch.type !== undefined && patch.type !== current.type) {
    warnings.push(
      `type alterado de ${current.type} para ${patch.type}. Verifique se o regulamento ainda é válido.`,
    );
  }

  const updated = await db.split.update({ where: { id }, data });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SPLIT_UPDATE,
    entity: "Split",
    entityId: id,
    before: splitSnapshot(current),
    after: splitSnapshot(updated),
    ip: actor.ip ?? null,
    metadata: warnings.length > 0 ? { warnings } : undefined,
  });

  return updated;
}

// ============================================================================
// 3. ACTIVATE (simples — sem exclusividade)
// ============================================================================

/**
 * Ativa um Split, deixando-o visível/operacional na plataforma.
 *
 * ====================
 * SEMÂNTICA DE MÚLTIPLOS SPLITS ATIVOS
 * ====================
 * Múltiplos splits podem estar ativos em paralelo dentro da mesma Season
 * (ex: grupos masculino e feminino). Ativação é flag administrativa livre.
 *
 * ====================
 * REGRAS DE NEGÓCIO
 * ====================
 * - Split já ativo → idempotente, retorna sem alterar.
 * - Split com endDate no passado → bloqueia (encerrado).
 * - Split não encontrado → NotFoundError.
 * - NÃO exigimos que a Season pai esteja ativa. Admin pode preparar splits
 *   de torneio futuro antes de abrir oficialmente.
 */
export async function activateSplit(
  id: string,
  actor: ActorContext,
): Promise<Split> {
  const current = await db.split.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Split não encontrado.");
  }

  if (current.endDate && current.endDate < new Date()) {
    throw new LeagueConflictError(
      "Não é possível ativar um split já encerrado.",
      "SPLIT_ENDED",
    );
  }

  // Idempotência
  if (current.isActive) {
    return current;
  }

  const activated = await db.split.update({
    where: { id },
    data: { isActive: true },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SPLIT_ACTIVATE,
    entity: "Split",
    entityId: id,
    before: { isActive: false },
    after: { isActive: true, name: activated.name },
    ip: actor.ip ?? null,
    metadata: { seasonId: activated.seasonId },
  });

  return activated;
}

// ============================================================================
// 4. DEACTIVATE
// ============================================================================

/**
 * Desativa um Split.
 *
 * Regras:
 *   - Bloqueia se houver Match com status LIVE dentro deste split
 *     (integridade — não interrompe partida em andamento).
 *   - Matches SCHEDULED, FINISHED, CANCELED, POSTPONED, FORFEIT não bloqueiam.
 *   - Se já está inativo, idempotente.
 *
 * Detalhe técnico:
 *   Match não tem FK direta para Split. Verificação é via traversal
 *   Match → Phase → Split usando helper countMatchesInSplitByStatus.
 */
export async function deactivateSplit(
  id: string,
  actor: ActorContext,
): Promise<Split> {
  const current = await db.split.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Split não encontrado.");
  }

  if (!current.isActive) {
    return current; // idempotente
  }

  const liveMatchCount = await countMatchesInSplitByStatus(
    id,
    MatchStatus.LIVE,
  );

  if (liveMatchCount > 0) {
    throw new LeagueConflictError(
      `Há ${liveMatchCount} partida(s) em andamento (LIVE) neste split. Finalize-as antes de desativar.`,
      "MATCH_STILL_LIVE",
    );
  }

  const updated = await db.split.update({
    where: { id },
    data: { isActive: false },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SPLIT_DEACTIVATE,
    entity: "Split",
    entityId: id,
    before: { isActive: true },
    after: { isActive: false },
    ip: actor.ip ?? null,
    metadata: { seasonId: updated.seasonId },
  });

  return updated;
}

// ============================================================================
// 5. READ (público)
// ============================================================================

/**
 * Retorna um Split pelo ID, com fases e grupos incluídos.
 * Uso típico: painel admin e página de detalhes do split.
 */
export async function getSplitById(id: string) {
  return db.split.findUnique({
    where: { id },
    include: {
      season: {
        select: { id: true, name: true, slug: true, shortCode: true },
      },
      phases: {
        orderBy: { order: "asc" },
        include: {
          groups: {
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });
}

/**
 * Listagem paginada de Splits com filtros opcionais.
 * Paginação por cursor (padrão E2.4).
 */
export async function listSplits(query: ListSplitsQuery) {
  const { seasonId, type, isActive, take, cursor } = query;

  const where: Prisma.SplitWhereInput = {
    ...(seasonId !== undefined && { seasonId }),
    ...(type !== undefined && { type }),
    ...(isActive !== undefined && { isActive }),
  };

  const items = await db.split.findMany({
    where,
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    include: {
      season: {
        select: { id: true, name: true, slug: true, shortCode: true },
      },
    },
  });

  let nextCursor: string | undefined;
  if (items.length > take) {
    const last = items.pop();
    nextCursor = last?.id;
  }

  return { items, nextCursor };
}

// ============================================================================
// 6. DELETE (hard delete — SUPER_ADMIN apenas, via rota)
// ============================================================================

/**
 * Remove permanentemente um Split.
 *
 * ====================
 * REGRAS ESTRITAS
 * ====================
 * - Requer SUPER_ADMIN (aplicado na rota via requireRole).
 * - Só pode deletar Split SEM dependentes em CADA um destes modelos:
 *     * Phase, Standing, RosterSnapshot, PlayoffSeries,
 *       PlayerSplitStat, EventRegistration, CharityCampaign,
 *       EventAlbum, SeasonAward
 * - Se houver qualquer dependente, sugerir deactivateSplit() no erro.
 *
 * Nota: matches não são verificados aqui porque matches dependem de Phase.
 *       Se existir Phase, o delete já é bloqueado — proteção transitiva.
 */
export async function deleteSplit(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.split.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          phases: true,
          standings: true,
          rosterSnapshots: true,
          playoffSeries: true,
          playerSplitStats: true,
          eventRegistrations: true,
          campaigns: true,
          albums: true,
          awards: true,
        },
      },
    },
  });

  if (!current) {
    throw new NotFoundError("Split não encontrado.");
  }

  const counts = current._count;
  const totalDependents =
    counts.phases +
    counts.standings +
    counts.rosterSnapshots +
    counts.playoffSeries +
    counts.playerSplitStats +
    counts.eventRegistrations +
    counts.campaigns +
    counts.albums +
    counts.awards;

  if (totalDependents > 0) {
    throw new LeagueConflictError(
      `Split possui ${totalDependents} dependente(s). Desative em vez de deletar.`,
      "SPLIT_HAS_DEPENDENTS",
    );
  }

  // Extrai _count antes do snapshot para satisfazer tipo Split puro
  const { _count, ...currentBase } = current;
  const snapshot = splitSnapshot(currentBase);

  await db.split.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SPLIT_DELETE,
    entity: "Split",
    entityId: id,
    before: snapshot,
    after: null,
    ip: actor.ip ?? null,
    metadata: { seasonId: current.seasonId },
  });
}

// ============================================================================
// FIM DO ARQUIVO
// ============================================================================
