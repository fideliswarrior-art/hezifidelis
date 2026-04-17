import { db } from "@/lib/db";
import type { Prisma, Group, TeamGroup } from "@prisma/client";
import { MatchStatus } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  type ActorContext,
  LeagueConflictError,
} from "@/lib/services/league/season.service";
import type {
  CreateGroupInput,
  UpdateGroupInput,
  ListGroupsQuery,
  AssignTeamToGroupInput,
  RemoveTeamFromGroupInput,
} from "@/lib/security/utils/validations.league";

/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE GROUP (Onda 3 - E3.1)
 * ============================================================================
 * Arquivo: lib/services/league/group.service.ts
 * Camada de Defesa: C3 (RBAC) + C4 (ABAC — time ativo) + C12 (Auditoria)
 *
 * RESPONSABILIDADE:
 * CRUD completo de Group (grupo dentro de uma Phase) + gestão da relação
 * N:M TeamGroup (quais times jogam em quais grupos).
 *
 * ============================================================================
 * PARTICULARIDADES DESTE MODEL
 * ============================================================================
 *
 * 1. Group NÃO TEM CAMPO isActive.
 *    Grupo está sempre disponível enquanto a Phase pai existir.
 *    Por isso NÃO existem activateGroup/deactivateGroup.
 *
 * 2. TeamGroup é uma TABELA DE JUNÇÃO N:M com chave primária COMPOSTA:
 *      @@id([teamId, groupId])
 *    Sem ID próprio. Operações usam `where: { teamId_groupId: {...} }`.
 *
 * 3. Assignação é IDEMPOTENTE:
 *    Se admin chama assignTeamToGroup duas vezes com os mesmos IDs,
 *    a segunda chamada retorna silenciosamente sem erro e sem AuditLog.
 *
 * 4. Validação de time ativo:
 *    assignTeamToGroup bloqueia se team.isActive = false.
 *    Times desativados não podem ser associados a grupos.
 *
 * 5. Alerta ao remover time com Match SCHEDULED:
 *    removeTeamFromGroup gera warning no AuditLog mas não bloqueia.
 *    Admin sabe o que está fazendo se está reorganizando a fase.
 *
 * ============================================================================
 * REGRAS CRÍTICAS:
 *   1. `phaseId` é IMUTÁVEL após criação. Grupo não migra entre fases.
 *   2. deleteGroup bloqueia se houver Match, Standing ou TeamGroup.
 *   3. Reutilização: ActorContext e LeagueConflictError vêm de season.service.ts.
 * ============================================================================
 */

// ============================================================================
// HELPERS INTERNOS (não exportados)
// ============================================================================

/**
 * Snapshot padronizado de Group para AuditLog.
 */
function groupSnapshot(g: Group) {
  return {
    id: g.id,
    name: g.name,
    phaseId: g.phaseId,
  };
}

/**
 * Valida que a Phase referenciada existe.
 */
async function assertPhaseExists(phaseId: string): Promise<void> {
  const phase = await db.phase.findUnique({
    where: { id: phaseId },
    select: { id: true },
  });
  if (!phase) {
    throw new NotFoundError(`Phase não encontrada (id: ${phaseId}).`);
  }
}

/**
 * Valida que o Team existe e está ativo.
 * Times desativados não podem ser associados a grupos.
 */
async function assertTeamActive(teamId: string): Promise<void> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, isActive: true },
  });
  if (!team) {
    throw new NotFoundError(`Time não encontrado (id: ${teamId}).`);
  }
  if (!team.isActive) {
    throw new LeagueConflictError(
      `Time "${team.name}" está desativado e não pode ser associado a grupos.`,
      "TEAM_INACTIVE",
    );
  }
}

/**
 * Valida que o Group existe e retorna o phaseId para uso em audit metadata.
 */
async function assertGroupExists(
  groupId: string,
): Promise<{ phaseId: string }> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, phaseId: true },
  });
  if (!group) {
    throw new NotFoundError(`Grupo não encontrado (id: ${groupId}).`);
  }
  return { phaseId: group.phaseId };
}

// ============================================================================
// 1. CREATE
// ============================================================================

/**
 * Cria um novo Group dentro de uma Phase.
 *
 * Regras:
 *   - A Phase pai DEVE existir.
 *   - Nomes duplicados são PERMITIDOS em phases diferentes (ex: "Grupo A"
 *     em duas phases distintas). Unicidade não é imposta aqui.
 */
export async function createGroup(
  input: CreateGroupInput,
  actor: ActorContext,
): Promise<Group> {
  await assertPhaseExists(input.phaseId);

  const created = await db.group.create({
    data: {
      name: input.name,
      phaseId: input.phaseId,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.GROUP_CREATE,
    entity: "Group",
    entityId: created.id,
    before: null,
    after: groupSnapshot(created),
    ip: actor.ip ?? null,
    metadata: { phaseId: created.phaseId },
  });

  return created;
}

// ============================================================================
// 2. UPDATE (apenas renomeação — Group não tem outros campos editáveis)
// ============================================================================

/**
 * Atualiza o nome de um Group.
 *
 * Regras:
 *   - `phaseId` NÃO é editável (Zod bloqueia; grupo não migra entre phases).
 *   - Apenas `name` é editável (único campo não-FK no model).
 */
export async function updateGroup(
  id: string,
  patch: UpdateGroupInput,
  actor: ActorContext,
): Promise<Group> {
  const current = await db.group.findUnique({ where: { id } });
  if (!current) {
    throw new NotFoundError("Grupo não encontrado.");
  }

  const data: Prisma.GroupUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;

  const updated = await db.group.update({ where: { id }, data });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.GROUP_UPDATE,
    entity: "Group",
    entityId: id,
    before: groupSnapshot(current),
    after: groupSnapshot(updated),
    ip: actor.ip ?? null,
    metadata: { phaseId: updated.phaseId },
  });

  return updated;
}

// ============================================================================
// 3. READ (público)
// ============================================================================

/**
 * Retorna um Group pelo ID, com times associados e standings.
 * Uso típico: página de detalhes do grupo (ex: "Grupo A" do torneio).
 */
export async function getGroupById(id: string) {
  return db.group.findUnique({
    where: { id },
    include: {
      phase: {
        select: {
          id: true,
          name: true,
          type: true,
          order: true,
          splitId: true,
          split: {
            select: {
              id: true,
              name: true,
              seasonId: true,
              season: {
                select: { id: true, name: true, slug: true, shortCode: true },
              },
            },
          },
        },
      },
      teamGroups: {
        include: {
          team: {
            select: {
              id: true,
              name: true,
              slug: true,
              shortName: true,
              logoUrl: true,
              primaryColor: true,
              isActive: true,
            },
          },
        },
      },
      standings: {
        orderBy: { position: "asc" },
      },
      _count: {
        select: { matches: true },
      },
    },
  });
}

/**
 * Listagem paginada de Groups com filtros opcionais.
 */
export async function listGroups(query: ListGroupsQuery) {
  const { phaseId, take, cursor } = query;

  const where: Prisma.GroupWhereInput = {
    ...(phaseId !== undefined && { phaseId }),
  };

  const items = await db.group.findMany({
    where,
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: [{ phaseId: "asc" }, { name: "asc" }],
    include: {
      phase: {
        select: { id: true, name: true, splitId: true },
      },
      _count: {
        select: { teamGroups: true, matches: true },
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
// 4. DELETE (ADMIN+ — bloqueia dependentes)
// ============================================================================

/**
 * Remove permanentemente um Group.
 *
 * Regras:
 *   - Requer ADMIN+ (aplicado na rota).
 *   - Bloqueia se houver Match, Standing ou TeamGroup associado.
 *   - Admin deve remover matches/standings/associações antes.
 *
 * Nota: TeamGroup NÃO é cascateado pelo Prisma (schema não tem
 *       onDelete: Cascade). Se houver associações, delete falha com
 *       erro de FK. Por isso verificamos e bloqueamos manualmente
 *       com mensagem amigável.
 */
export async function deleteGroup(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.group.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          matches: true,
          standings: true,
          teamGroups: true,
        },
      },
    },
  });

  if (!current) {
    throw new NotFoundError("Grupo não encontrado.");
  }

  const counts = current._count;
  const totalDependents = counts.matches + counts.standings + counts.teamGroups;

  if (totalDependents > 0) {
    const details: string[] = [];
    if (counts.teamGroups > 0)
      details.push(`${counts.teamGroups} time(s) associado(s)`);
    if (counts.matches > 0) details.push(`${counts.matches} partida(s)`);
    if (counts.standings > 0)
      details.push(`${counts.standings} classificação(ões)`);

    throw new LeagueConflictError(
      `Grupo possui ${totalDependents} dependente(s): ${details.join(", ")}. Remova-os antes de deletar.`,
      "GROUP_HAS_DEPENDENTS",
    );
  }

  // Extrai _count antes do snapshot
  const { _count, ...currentBase } = current;
  const snapshot = groupSnapshot(currentBase);

  await db.group.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.GROUP_DELETE,
    entity: "Group",
    entityId: id,
    before: snapshot,
    after: null,
    ip: actor.ip ?? null,
    metadata: { phaseId: current.phaseId },
  });
}

// ============================================================================
// 5. ASSIGN TEAM TO GROUP (gestão da tabela de junção TeamGroup)
// ============================================================================

/**
 * Associa um Time a um Grupo.
 *
 * ============================================================================
 * IDEMPOTÊNCIA
 * ============================================================================
 * Se a associação (teamId, groupId) já existe, retorna silenciosamente
 * SEM erro e SEM gerar AuditLog. Isso evita poluição do log quando
 * frontend fizer retry ou admin clicar duas vezes.
 *
 * ============================================================================
 * VALIDAÇÕES
 * ============================================================================
 *   1. O Time DEVE existir e estar ativo (isActive = true).
 *   2. O Grupo DEVE existir.
 *
 * ============================================================================
 * DETALHE TÉCNICO — CHAVE COMPOSTA
 * ============================================================================
 * O model TeamGroup tem @@id([teamId, groupId]) — sem campo id próprio.
 * Operações usam where com a chave composta gerada pelo Prisma:
 *   { teamId_groupId: { teamId, groupId } }
 */
export async function assignTeamToGroup(
  input: AssignTeamToGroupInput,
  actor: ActorContext,
): Promise<TeamGroup> {
  const { teamId, groupId } = input;

  // 1. Validações paralelas (2 queries independentes)
  await Promise.all([assertTeamActive(teamId), assertGroupExists(groupId)]);

  // 2. Verifica se já existe — idempotência silenciosa
  const existing = await db.teamGroup.findUnique({
    where: {
      teamId_groupId: { teamId, groupId },
    },
  });

  if (existing) {
    return existing; // idempotente — sem AuditLog para não poluir
  }

  // 3. Cria a associação
  const created = await db.teamGroup.create({
    data: { teamId, groupId },
  });

  // 4. Carrega metadados para enriquecer o AuditLog
  const [team, group] = await Promise.all([
    db.team.findUnique({
      where: { id: teamId },
      select: { name: true },
    }),
    db.group.findUnique({
      where: { id: groupId },
      select: { name: true, phaseId: true },
    }),
  ]);

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_GROUP_ASSIGN,
    entity: "TeamGroup",
    entityId: `${teamId}:${groupId}`, // chave composta como entityId
    before: null,
    after: { teamId, groupId },
    ip: actor.ip ?? null,
    metadata: {
      teamName: team?.name,
      groupName: group?.name,
      phaseId: group?.phaseId,
    },
  });

  return created;
}

// ============================================================================
// 6. REMOVE TEAM FROM GROUP (gestão da tabela de junção)
// ============================================================================

/**
 * Remove a associação de um Time com um Grupo.
 *
 * ============================================================================
 * IDEMPOTÊNCIA
 * ============================================================================
 * Se a associação NÃO existe, retorna silenciosamente (sem erro, sem log).
 * Permite retry seguro do frontend.
 *
 * ============================================================================
 * ALERTA DE MATCH AGENDADO (warning — não bloqueia)
 * ============================================================================
 * Se o time tem Match SCHEDULED dentro da MESMA PHASE deste grupo
 * (ex: partidas do próprio grupo ou de outros grupos da mesma fase),
 * o service gera warning no AuditLog.metadata mas NÃO BLOQUEIA a operação.
 *
 * Motivo: admin pode estar reorganizando grupos antes do início da fase
 * e sabe o que está fazendo. Bloqueio rígido prejudicaria o fluxo
 * administrativo normal.
 */
export async function removeTeamFromGroup(
  input: RemoveTeamFromGroupInput,
  actor: ActorContext,
): Promise<void> {
  const { teamId, groupId } = input;

  const existing = await db.teamGroup.findUnique({
    where: {
      teamId_groupId: { teamId, groupId },
    },
  });

  if (!existing) {
    return; // idempotente — associação já não existe
  }

  // Carrega group para obter phaseId (usado no check de matches agendados)
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { name: true, phaseId: true },
  });

  // Verifica matches agendados envolvendo esse time na mesma phase
  let scheduledMatchCount = 0;
  if (group) {
    scheduledMatchCount = await db.match.count({
      where: {
        phaseId: group.phaseId,
        status: MatchStatus.SCHEDULED,
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
    });
  }

  // Remove a associação
  await db.teamGroup.delete({
    where: {
      teamId_groupId: { teamId, groupId },
    },
  });

  // Carrega team name para enriquecer audit
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });

  const warnings: string[] = [];
  if (scheduledMatchCount > 0) {
    warnings.push(
      `Time "${team?.name}" possui ${scheduledMatchCount} partida(s) agendada(s) nesta fase. Verifique se precisam ser canceladas ou realocadas.`,
    );
  }

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_GROUP_REMOVE,
    entity: "TeamGroup",
    entityId: `${teamId}:${groupId}`,
    before: { teamId, groupId },
    after: null,
    ip: actor.ip ?? null,
    metadata: {
      teamName: team?.name,
      groupName: group?.name,
      phaseId: group?.phaseId,
      ...(warnings.length > 0 && { warnings }),
    },
  });
}

// ============================================================================
// FIM DO ARQUIVO
// ============================================================================
