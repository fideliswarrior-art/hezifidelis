import { db } from "@/lib/db";
import type { Prisma, Season } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { sanitizePlainText } from "@/lib/security/content/sanitize";
import { NotFoundError } from "@/lib/security/utils/errors";
import type {
  CreateSeasonInput,
  UpdateSeasonInput,
  ListSeasonsQuery,
} from "@/lib/security/utils/validations.league";

/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE SEASON (Onda 3 - E3.1)
 * ============================================================================
 * Arquivo: lib/services/league/season.service.ts
 * Camada de Defesa: C3 (RBAC) + C6 (Workflow) + C12 (Observabilidade)
 *
 * RESPONSABILIDADE:
 * CRUD completo de Season (Torneio) suportando MÚLTIPLOS TORNEIOS
 * SIMULTÂNEOS em paralelo na plataforma comunitária.
 *
 * PRINCÍPIO ARQUITETURAL FUNDAMENTAL:
 * A Hezi Tech roda N torneios em paralelo. `isActive` é uma FLAG
 * ADMINISTRATIVA manipulada livremente pelo admin — NÃO há regra de
 * exclusividade. É perfeitamente válido ter 5 Seasons `isActive = true`
 * rodando ao mesmo tempo (ex: Copa Abril + Copa Julho + Liga Feminina +
 * 3x3 Verão + Draft Comunitário).
 *
 * IDENTIFICADORES ÚNICOS:
 *   - `slug`: URL amigável (`/torneios/copa-abril-2026`) — unique globalmente
 *   - `shortCode`: identificador curto alfanumérico (`CAB26`) — unique globalmente
 *   - `id` (UUID): chave primária interna
 *
 * REGRAS CRÍTICAS:
 *   1. Nenhum método aceita `isActive` como parâmetro direto.
 *      Ativação/desativação só via activateSeason() / deactivateSeason().
 *
 *   2. `slug` e `shortCode` são imutáveis por padrão; alteração gera
 *      ALERTA no AuditLog (quebra URLs antigas e badges).
 *
 *   3. deactivateSeason() bloqueia se houver Split ativo dentro dela
 *      (evita órfão UX — split visível sem season ativa confunde o frontend).
 *
 *   4. deleteSeason() é HARD DELETE restrito a SUPER_ADMIN e só para seasons
 *      sem dependentes. Caso contrário, sugerir desativação (soft delete).
 *
 *   5. Todo Input passa por Zod na ROTA (E3.5). Aqui confiamos no tipo.
 *      Toda STRING de texto livre é sanitizada via sanitizePlainText (E2.2).
 *
 *   6. AuditLog em TODA mutation. `before`/`after` são snapshots dos campos
 *      relevantes para reconstrução histórica.
 * ============================================================================
 */

// ============================================================================
// TIPOS INTERNOS
// ============================================================================

/**
 * Contexto do ator que executa a operação.
 * Vem do `requireAuth` (Fase 1) ou `requireRole` (Fase 1).
 *
 * Campo `ip` é opcional porque o service pode ser chamado de jobs de cron
 * (sem contexto HTTP) onde getClientIp() retorna null.
 */
export interface ActorContext {
  userId: string;
  role: string;
  ip?: string | null;
}

/**
 * Erro específico de regra de negócio de Season/Split/Phase/Group.
 * Mapeado pelo safe-route.ts (Onda 1) via statusCode genérico.
 */
export class LeagueConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code: string;

  constructor(message: string, code = "LEAGUE_CONFLICT") {
    super(message);
    this.name = "LeagueConflictError";
    this.code = code;
  }
}

// ============================================================================
// HELPERS INTERNOS (não exportados)
// ============================================================================

/**
 * Snapshot padronizado de Season para AuditLog.
 * Mantém apenas campos relevantes para comparação before/after.
 */
function seasonSnapshot(s: Season) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    shortCode: s.shortCode,
    year: s.year,
    isActive: s.isActive,
    startDate: s.startDate.toISOString(),
    endDate: s.endDate ? s.endDate.toISOString() : null,
  };
}

/**
 * Verifica se slug ou shortCode já existem no banco.
 * Usado em create e update para falhar rápido com mensagem amigável
 * antes de cair no erro P2002 cru do Prisma.
 */
async function assertSlugAndShortCodeAvailable(
  slug: string | undefined,
  shortCode: string | undefined,
  excludeId?: string,
): Promise<void> {
  if (!slug && !shortCode) return;

  const conditions: Prisma.SeasonWhereInput[] = [];
  if (slug) conditions.push({ slug });
  if (shortCode) conditions.push({ shortCode });

  const existing = await db.season.findFirst({
    where: {
      OR: conditions,
      ...(excludeId && { NOT: { id: excludeId } }),
    },
    select: { id: true, slug: true, shortCode: true },
  });

  if (!existing) return;

  if (slug && existing.slug === slug) {
    throw new LeagueConflictError(
      `Já existe uma temporada com o slug "${slug}".`,
      "SLUG_ALREADY_EXISTS",
    );
  }
  if (shortCode && existing.shortCode === shortCode) {
    throw new LeagueConflictError(
      `Já existe uma temporada com o código "${shortCode}".`,
      "SHORT_CODE_ALREADY_EXISTS",
    );
  }
}

// ============================================================================
// 1. CREATE
// ============================================================================

/**
 * Cria uma nova Season (Torneio).
 *
 * Regras de negócio:
 *   - A season NUNCA nasce com isActive = true. Para ativar, chamar
 *     activateSeason() separadamente.
 *   - `slug` e `shortCode` DEVEM ser únicos globalmente.
 *   - `description` é sanitizada via sanitizePlainText (E2.2).
 */
export async function createSeason(
  input: CreateSeasonInput,
  actor: ActorContext,
): Promise<Season> {
  // Defesa antecipada: mensagem amigável em vez de P2002 do Prisma
  await assertSlugAndShortCodeAvailable(input.slug, input.shortCode);

  const created = await db.season.create({
    data: {
      name: input.name,
      slug: input.slug,
      shortCode: input.shortCode,
      year: input.year,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      description: input.description
        ? sanitizePlainText(input.description, 2000)
        : null,
      isActive: false, // SEMPRE false na criação — regra inegociável
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SEASON_CREATE,
    entity: "Season",
    entityId: created.id,
    before: null,
    after: seasonSnapshot(created),
    ip: actor.ip ?? null,
  });

  return created;
}

// ============================================================================
// 2. UPDATE (metadados — não mexe em isActive)
// ============================================================================

/**
 * Atualiza metadados de uma Season.
 *
 * Regras:
 *   - `isActive` NÃO é editável por este método.
 *   - Alteração de `slug` ou `shortCode` → ALERTA no AuditLog.metadata
 *     porque quebra URLs e badges existentes no frontend/mobile.
 *   - Unicidade de slug/shortCode validada antes do UPDATE.
 */
export async function updateSeason(
  id: string,
  patch: UpdateSeasonInput,
  actor: ActorContext,
): Promise<Season> {
  const current = await db.season.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Season não encontrada.");
  }

  // Se está tentando alterar slug/shortCode, validar unicidade
  if (patch.slug !== undefined || patch.shortCode !== undefined) {
    await assertSlugAndShortCodeAvailable(patch.slug, patch.shortCode, id);
  }

  // Monta data respeitando exactOptionalPropertyTypes
  const data: Prisma.SeasonUpdateInput = {};

  if (patch.name !== undefined) data.name = patch.name;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.shortCode !== undefined) data.shortCode = patch.shortCode;
  if (patch.year !== undefined) data.year = patch.year;
  if (patch.startDate !== undefined) data.startDate = patch.startDate;
  if (patch.endDate !== undefined) data.endDate = patch.endDate ?? null;
  if (patch.description !== undefined) {
    data.description = patch.description
      ? sanitizePlainText(patch.description, 2000)
      : null;
  }

  const updated = await db.season.update({ where: { id }, data });

  // Detecta mudança de identificadores URL/badge — alerta no audit
  const breakingChanges: Record<string, { from: string; to: string }> = {};
  if (patch.slug !== undefined && patch.slug !== current.slug) {
    breakingChanges.slug = { from: current.slug, to: patch.slug };
  }
  if (patch.shortCode !== undefined && patch.shortCode !== current.shortCode) {
    breakingChanges.shortCode = {
      from: current.shortCode,
      to: patch.shortCode,
    };
  }

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SEASON_UPDATE,
    entity: "Season",
    entityId: id,
    before: seasonSnapshot(current),
    after: seasonSnapshot(updated),
    ip: actor.ip ?? null,
    metadata:
      Object.keys(breakingChanges).length > 0
        ? {
            breakingChanges,
            warning:
              "Identificadores de URL/badge alterados — URLs antigas podem quebrar.",
          }
        : undefined,
  });

  return updated;
}

// ============================================================================
// 3. ACTIVATE (simples — sem exclusividade)
// ============================================================================

/**
 * Ativa uma Season, deixando-a visível/operacional na plataforma.
 *
 * ====================
 * SEMÂNTICA DE MÚLTIPLOS TORNEIOS
 * ====================
 * Diferente de sistemas de liga única (ex: uma NBA season por vez), a Hezi
 * Tech permite múltiplas Seasons `isActive = true` em paralelo. Ativação
 * aqui é uma flag administrativa — admin decide quando o torneio fica
 * visível para o público, independente de datas.
 *
 * Não há transação atômica nem coordenação com outras Seasons.
 *
 * ====================
 * REGRAS DE NEGÓCIO
 * ====================
 * - Season já ativa → idempotente, retorna sem alterar e sem AuditLog.
 * - Season com endDate no passado → bloqueia (encerrada).
 * - Season não encontrada → NotFoundError.
 *
 * ====================
 * AUDITLOG
 * ====================
 * Apenas se houver mudança real de estado (não-idempotente).
 */
export async function activateSeason(
  id: string,
  actor: ActorContext,
): Promise<Season> {
  const current = await db.season.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Season não encontrada.");
  }

  if (current.endDate && current.endDate < new Date()) {
    throw new LeagueConflictError(
      "Não é possível ativar uma season já encerrada.",
      "SEASON_ENDED",
    );
  }

  // Idempotência — não gera AuditLog se já está ativa
  if (current.isActive) {
    return current;
  }

  const activated = await db.season.update({
    where: { id },
    data: { isActive: true },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SEASON_ACTIVATE,
    entity: "Season",
    entityId: id,
    before: { isActive: false },
    after: { isActive: true, name: activated.name, slug: activated.slug },
    ip: actor.ip ?? null,
  });

  return activated;
}

// ============================================================================
// 4. DEACTIVATE
// ============================================================================

/**
 * Desativa uma Season.
 *
 * Regras:
 *   - Bloqueia se houver qualquer Split ativo dentro dessa Season
 *     (evita órfão — split visível sem season ativa confunde o frontend).
 *     Admin deve desativar os splits antes.
 *   - Se já está inativa, idempotente (sem AuditLog).
 */
export async function deactivateSeason(
  id: string,
  actor: ActorContext,
): Promise<Season> {
  const current = await db.season.findUnique({
    where: { id },
    include: {
      splits: {
        where: { isActive: true },
        select: { id: true, name: true },
      },
    },
  });

  if (!current) {
    throw new NotFoundError("Season não encontrada.");
  }

  if (!current.isActive) {
    return current; // idempotente
  }

  if (current.splits.length > 0) {
    throw new LeagueConflictError(
      `Desative o(s) split(s) ativo(s) primeiro: ${current.splits
        .map((s) => s.name)
        .join(", ")}.`,
      "SPLIT_STILL_ACTIVE",
    );
  }

  const updated = await db.season.update({
    where: { id },
    data: { isActive: false },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SEASON_DEACTIVATE,
    entity: "Season",
    entityId: id,
    before: { isActive: true },
    after: { isActive: false },
    ip: actor.ip ?? null,
  });

  return updated;
}

// ============================================================================
// 5. READ (público)
// ============================================================================

/**
 * Retorna uma Season pelo ID, com splits incluídos.
 * Uso típico: painel admin.
 */
export async function getSeasonById(id: string) {
  return db.season.findUnique({
    where: { id },
    include: {
      splits: {
        orderBy: { startDate: "asc" },
      },
    },
  });
}

/**
 * Retorna uma Season pelo SLUG, com splits incluídos.
 * Uso típico: frontend público em /torneios/[slug].
 *
 * Aceita apenas Seasons ativas por padrão (para público). Para admin
 * ver seasons inativas, usar getSeasonById ou listSeasons com isActive: false.
 */
export async function getSeasonBySlug(slug: string, includeInactive = false) {
  return db.season.findUnique({
    where: { slug },
    include: {
      splits: {
        ...(includeInactive ? {} : { where: { isActive: true } }),
        orderBy: { startDate: "asc" },
      },
    },
  });
}

/**
 * Listagem paginada de Seasons com filtros opcionais.
 * Paginação por cursor (padrão estabelecido em E2.4).
 */
export async function listSeasons(query: ListSeasonsQuery) {
  const { year, isActive, slug, take, cursor } = query;

  const where: Prisma.SeasonWhereInput = {
    ...(year !== undefined && { year }),
    ...(isActive !== undefined && { isActive }),
    ...(slug !== undefined && { slug }),
  };

  const items = await db.season.findMany({
    where,
    take: take + 1, // +1 para detectar próxima página
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
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
 * Remove permanentemente uma Season.
 *
 * ====================
 * REGRAS ESTRITAS
 * ====================
 * - Requer SUPER_ADMIN (aplicado na rota via requireRole).
 * - Só pode deletar Season SEM dependentes em CADA um destes modelos:
 *     * Split, Draft, PlayerSeasonStat, SeasonAward,
 *       TeamSponsor, LeagueSponsor, FreeAgentProfile
 * - Se houver qualquer dependente, sugerir deactivateSeason() no erro.
 *
 * ====================
 * POR QUE NÃO ONDELETE CASCADE?
 * ====================
 * Cascatear Season apagaria PlayerSeasonStat e SeasonAward, destruindo
 * história competitiva. INADMISSÍVEL — Art. 37 LGPD e integridade histórica.
 *
 * ====================
 * AUDITLOG
 * ====================
 * Snapshot ANTES do delete vai em `before`. `after` = null.
 */
export async function deleteSeason(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.season.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          splits: true,
          drafts: true,
          playerStats: true,
          awards: true,
          teamSponsors: true,
          leagueSponsors: true,
          freeAgentProfiles: true,
        },
      },
    },
  });

  if (!current) {
    throw new NotFoundError("Season não encontrada.");
  }

  const counts = current._count;
  const totalDependents =
    counts.splits +
    counts.drafts +
    counts.playerStats +
    counts.awards +
    counts.teamSponsors +
    counts.leagueSponsors +
    counts.freeAgentProfiles;

  if (totalDependents > 0) {
    throw new LeagueConflictError(
      `Season possui ${totalDependents} dependente(s). Desative em vez de deletar.`,
      "SEASON_HAS_DEPENDENTS",
    );
  }

  // Snapshot antes de deletar
  const snapshot = seasonSnapshot(current);

  await db.season.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.SEASON_DELETE,
    entity: "Season",
    entityId: id,
    before: snapshot,
    after: null,
    ip: actor.ip ?? null,
  });
}

// ============================================================================
// FIM DO ARQUIVO
// ============================================================================
