import { db } from "@/lib/db";
import type { Prisma, Phase } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { NotFoundError } from "@/lib/security/utils/errors";
import {
  type ActorContext,
  LeagueConflictError,
} from "@/lib/services/league/season.service";
import type {
  CreatePhaseInput,
  UpdatePhaseInput,
  ReorderPhasesInput,
  ListPhasesQuery,
} from "@/lib/security/utils/validations.league";

/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE PHASE (Onda 3 - E3.1)
 * ============================================================================
 * Arquivo: lib/services/league/phase.service.ts
 * Camada de Defesa: C3 (RBAC) + C6 (Workflow) + C12 (Observabilidade)
 *
 * RESPONSABILIDADE:
 * CRUD completo de Phase (fase dentro de um Split) + reordenação em lote.
 *
 * ============================================================================
 * DETALHE TÉCNICO CRÍTICO — AUSÊNCIA DE CONSTRAINT DE UNICIDADE
 * ============================================================================
 * O schema Prisma atualmente NÃO possui @@unique([splitId, order]) no model
 * Phase. Isso significa que:
 *   - O BANCO não impede duas phases com mesmo order no mesmo split.
 *   - A UNICIDADE é responsabilidade INTEGRAL deste service.
 *
 * Estratégia:
 *   1. createPhase: verifica colisão antes do INSERT.
 *   2. updatePhase (quando altera order): verifica colisão antes do UPDATE.
 *   3. reorderPhases: transação com "shift temporário" (valores negativos)
 *      para evitar colisão intermediária — código robusto o suficiente
 *      para continuar funcionando caso uma migration futura adicione
 *      @@unique([splitId, order]).
 *
 * REGRAS CRÍTICAS:
 *   1. `splitId` é IMUTÁVEL após criação. Phase não migra de split.
 *
 *   2. reorderPhases exige TODAS as phases do split no array. Reordenação
 *      parcial é rejeitada (evita órfãos com order duplicado).
 *
 *   3. deletePhase bloqueia se houver Match, PlayoffSeries ou Group vinculado.
 *
 *   4. Alteração de `type` com Match vinculado → WARNING no AuditLog
 *      (afeta regulamento implícito da fase).
 *
 *   5. Reutilização: `ActorContext` e `LeagueConflictError` vêm de
 *      season.service.ts.
 * ============================================================================
 */

// ============================================================================
// HELPERS INTERNOS (não exportados)
// ============================================================================

/**
 * Snapshot padronizado de Phase para AuditLog.
 */
function phaseSnapshot(p: Phase) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    splitId: p.splitId,
    order: p.order,
  };
}

/**
 * Valida que o Split referenciado existe.
 */
async function assertSplitExists(splitId: string): Promise<void> {
  const split = await db.split.findUnique({
    where: { id: splitId },
    select: { id: true },
  });
  if (!split) {
    throw new NotFoundError(`Split não encontrado (id: ${splitId}).`);
  }
}

/**
 * Verifica se já existe Phase com o (splitId, order) informado.
 * Usado em create e update para compensar a ausência de @@unique no schema.
 *
 * @param excludeId Se informado, ignora essa phase na verificação (útil no update).
 */
async function assertOrderAvailable(
  splitId: string,
  order: number,
  excludeId?: string,
): Promise<void> {
  const existing = await db.phase.findFirst({
    where: {
      splitId,
      order,
      ...(excludeId && { NOT: { id: excludeId } }),
    },
    select: { id: true, name: true },
  });

  if (existing) {
    throw new LeagueConflictError(
      `Já existe uma fase com ordem ${order} neste split (${existing.name}). Use reorderPhases para trocar ordens em lote.`,
      "PHASE_ORDER_ALREADY_EXISTS",
    );
  }
}

// ============================================================================
// 1. CREATE
// ============================================================================

/**
 * Cria uma nova Phase dentro de um Split.
 *
 * Regras:
 *   - O Split pai DEVE existir.
 *   - O `order` DEVE ser único dentro do split (validado pelo service).
 *   - Não bloqueia criação em splits inativos — permite planejamento.
 */
export async function createPhase(
  input: CreatePhaseInput,
  actor: ActorContext,
): Promise<Phase> {
  await assertSplitExists(input.splitId);
  await assertOrderAvailable(input.splitId, input.order);

  const created = await db.phase.create({
    data: {
      name: input.name,
      type: input.type,
      splitId: input.splitId,
      order: input.order,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PHASE_CREATE,
    entity: "Phase",
    entityId: created.id,
    before: null,
    after: phaseSnapshot(created),
    ip: actor.ip ?? null,
    metadata: { splitId: created.splitId },
  });

  return created;
}

// ============================================================================
// 2. UPDATE (metadados + possível alteração de order)
// ============================================================================

/**
 * Atualiza metadados de uma Phase.
 *
 * Regras:
 *   - `splitId` NÃO é editável (Zod bloqueia; phase não migra).
 *   - Alterar `order` verifica colisão no service (ausência de @@unique).
 *   - Alterar `type` com Match vinculado gera WARNING no AuditLog.
 *
 * Para trocar ordem entre DUAS phases (A=1 ↔ B=2), use reorderPhases
 * que aplica transação com shift temporário. Updates sequenciais via
 * este método vão falhar no primeiro (colisão detectada).
 */
export async function updatePhase(
  id: string,
  patch: UpdatePhaseInput,
  actor: ActorContext,
): Promise<Phase> {
  const current = await db.phase.findUnique({
    where: { id },
    include: {
      _count: {
        select: { matches: true },
      },
    },
  });
  if (!current) {
    throw new NotFoundError("Phase não encontrada.");
  }

  // Se está tentando alterar order, validar unicidade dentro do mesmo split
  if (patch.order !== undefined && patch.order !== current.order) {
    await assertOrderAvailable(current.splitId, patch.order, id);
  }

  // Monta data respeitando exactOptionalPropertyTypes
  const data: Prisma.PhaseUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.order !== undefined) data.order = patch.order;

  // Detecta warnings antes do UPDATE
  const warnings: string[] = [];
  if (
    patch.type !== undefined &&
    patch.type !== current.type &&
    current._count.matches > 0
  ) {
    warnings.push(
      `type alterado de ${current.type} para ${patch.type} em fase com ${current._count.matches} partida(s). Verifique se o regulamento ainda é válido.`,
    );
  }

  const updated = await db.phase.update({ where: { id }, data });

  // Extrai _count para snapshot do current (compatibilidade com phaseSnapshot)
  const { _count, ...currentBase } = current;

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PHASE_UPDATE,
    entity: "Phase",
    entityId: id,
    before: phaseSnapshot(currentBase),
    after: phaseSnapshot(updated),
    ip: actor.ip ?? null,
    metadata: {
      splitId: updated.splitId,
      ...(warnings.length > 0 && { warnings }),
    },
  });

  return updated;
}

// ============================================================================
// 3. REORDER (transação com shift temporário — ponto mais técnico do arquivo)
// ============================================================================

/**
 * Reordena em lote as phases de um split.
 *
 * =============================================================================
 * ESTRATÉGIA "SHIFT TEMPORÁRIO" (defesa em profundidade)
 * =============================================================================
 * Embora o schema atual não tenha @@unique([splitId, order]), implementamos
 * a reordenação usando valores temporários negativos para garantir que
 * o código continue funcionando caso uma migration futura adicione a
 * constraint.
 *
 * Processo em 2 fases dentro de uma transação atômica:
 *
 *   FASE 1 — "Shift temporário":
 *     Para cada phase no array, atribui order = -(i+1) onde i é o índice.
 *     Ex: 3 phases → orders temporários = -1, -2, -3.
 *     Como são valores negativos e o input sempre tem valores >= 1,
 *     não há colisão nem mesmo com phases fora do array (se existirem).
 *
 *   FASE 2 — "Aplicação final":
 *     Para cada phase, atribui order = i+1 (1, 2, 3, ...).
 *     Como a FASE 1 já limpou as posições, não há colisão.
 *
 * =============================================================================
 * VALIDAÇÕES PRÉ-TRANSAÇÃO
 * =============================================================================
 *   1. O Split deve existir.
 *   2. TODAS as phaseIds do array devem pertencer ao splitId informado.
 *   3. TODAS as phases existentes no split devem estar no array.
 *      → Reordenação parcial é rejeitada: se split tem 5 phases e admin
 *        envia só 3 phaseIds, retorna 409 com a lista das faltantes.
 *      → Motivo: phases fora do array manteriam seus orders antigos,
 *        podendo colidir (ex: order=2 fora + novo order=2 no array).
 *
 * =============================================================================
 * AUDITLOG
 * =============================================================================
 * Gera UM único evento PHASE_REORDER com before/after das phases afetadas
 * em metadata.changes (lista de { phaseId, fromOrder, toOrder }).
 */
export async function reorderPhases(
  input: ReorderPhasesInput,
  actor: ActorContext,
): Promise<Phase[]> {
  const { splitId, phaseIds } = input;

  // 1. Valida que o split existe
  await assertSplitExists(splitId);

  // 2. Carrega TODAS as phases do split (para validação e snapshot before)
  const existingPhases = await db.phase.findMany({
    where: { splitId },
    orderBy: { order: "asc" },
  });

  // 3. Valida que TODAS as phases do split estão no array (reordenação total)
  const existingIds = new Set(existingPhases.map((p) => p.id));
  const inputIds = new Set(phaseIds);

  // 3a. phaseIds contém fases que não existem ou não pertencem ao split?
  const invalidIds = phaseIds.filter((id) => !existingIds.has(id));
  if (invalidIds.length > 0) {
    throw new LeagueConflictError(
      `Algumas phaseIds não pertencem a este split: ${invalidIds.join(", ")}.`,
      "PHASE_NOT_IN_SPLIT",
    );
  }

  // 3b. Existem phases do split que não foram incluídas no array?
  const missingFromInput = existingPhases
    .filter((p) => !inputIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, order: p.order }));

  if (missingFromInput.length > 0) {
    throw new LeagueConflictError(
      `Reordenação deve incluir TODAS as fases do split. Faltando: ${missingFromInput
        .map((p) => `"${p.name}" (ordem ${p.order})`)
        .join(", ")}.`,
      "PARTIAL_REORDER_NOT_ALLOWED",
    );
  }

  // 4. Monta snapshot before (antes da reordenação)
  const beforeSnapshot = existingPhases.map((p) => ({
    id: p.id,
    name: p.name,
    order: p.order,
  }));

  // 5. Transação atômica: FASE 1 (shift temporário) + FASE 2 (aplicação final)
  const updatedPhases = await db.$transaction(async (tx) => {
    // FASE 1 — shift temporário com valores negativos
    for (let i = 0; i < phaseIds.length; i++) {
      const phaseId = phaseIds[i]!; // non-null: array já validado
      await tx.phase.update({
        where: { id: phaseId },
        data: { order: -(i + 1) },
      });
    }

    // FASE 2 — aplicação final dos orders 1..N
    const results: Phase[] = [];
    for (let i = 0; i < phaseIds.length; i++) {
      const phaseId = phaseIds[i]!;
      const updated = await tx.phase.update({
        where: { id: phaseId },
        data: { order: i + 1 },
      });
      results.push(updated);
    }

    return results;
  });

  // 6. Monta snapshot after e lista de mudanças
  const afterMap = new Map(updatedPhases.map((p) => [p.id, p.order]));
  const changes = beforeSnapshot
    .filter((p) => afterMap.get(p.id) !== p.order)
    .map((p) => ({
      phaseId: p.id,
      phaseName: p.name,
      fromOrder: p.order,
      toOrder: afterMap.get(p.id)!,
    }));

  // 7. AuditLog único para toda a operação
  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PHASE_REORDER,
    entity: "Phase",
    entityId: splitId, // entityId = splitId porque afeta múltiplas phases
    before: { phases: beforeSnapshot },
    after: {
      phases: updatedPhases.map((p) => ({
        id: p.id,
        name: p.name,
        order: p.order,
      })),
    },
    ip: actor.ip ?? null,
    metadata: {
      splitId,
      phaseCount: updatedPhases.length,
      changes,
    },
  });

  return updatedPhases;
}

// ============================================================================
// 4. READ (público)
// ============================================================================

/**
 * Retorna uma Phase pelo ID, com groups incluídos.
 */
export async function getPhaseById(id: string) {
  return db.phase.findUnique({
    where: { id },
    include: {
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
      groups: {
        orderBy: { name: "asc" },
      },
      _count: {
        select: { matches: true, playoffSeries: true },
      },
    },
  });
}

/**
 * Listagem paginada de Phases com filtros opcionais.
 */
export async function listPhases(query: ListPhasesQuery) {
  const { splitId, type, take, cursor } = query;

  const where: Prisma.PhaseWhereInput = {
    ...(splitId !== undefined && { splitId }),
    ...(type !== undefined && { type }),
  };

  const items = await db.phase.findMany({
    where,
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: [{ splitId: "asc" }, { order: "asc" }],
    include: {
      split: {
        select: { id: true, name: true, seasonId: true },
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
// 5. DELETE (ADMIN+ — não é SUPER_ADMIN porque Phase tem menor criticidade)
// ============================================================================

/**
 * Remove permanentemente uma Phase.
 *
 * Regras:
 *   - Requer ADMIN+ (aplicado na rota).
 *   - Bloqueia se houver Match, PlayoffSeries ou Group vinculado.
 *   - Se houver dependentes, admin deve remover/migrar antes.
 *
 * Nota: grupos sob a phase NÃO são cascateados. O schema não tem
 *       onDelete: Cascade em Group.phaseId, então precisamos bloquear
 *       manualmente ou o Prisma lança erro de FK.
 */
export async function deletePhase(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.phase.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          matches: true,
          playoffSeries: true,
          groups: true,
        },
      },
    },
  });

  if (!current) {
    throw new NotFoundError("Phase não encontrada.");
  }

  const counts = current._count;
  const totalDependents = counts.matches + counts.playoffSeries + counts.groups;

  if (totalDependents > 0) {
    const details: string[] = [];
    if (counts.matches > 0) details.push(`${counts.matches} partida(s)`);
    if (counts.playoffSeries > 0)
      details.push(`${counts.playoffSeries} série(s) de playoffs`);
    if (counts.groups > 0) details.push(`${counts.groups} grupo(s)`);

    throw new LeagueConflictError(
      `Phase possui ${totalDependents} dependente(s): ${details.join(", ")}. Remova-os antes de deletar.`,
      "PHASE_HAS_DEPENDENTS",
    );
  }

  // Extrai _count antes do snapshot
  const { _count, ...currentBase } = current;
  const snapshot = phaseSnapshot(currentBase);

  await db.phase.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.PHASE_DELETE,
    entity: "Phase",
    entityId: id,
    before: snapshot,
    after: null,
    ip: actor.ip ?? null,
    metadata: { splitId: current.splitId },
  });
}

// ============================================================================
// FIM DO ARQUIVO
// ============================================================================
