/**
 * ============================================================================
 * HEZI TECH — SERVIÇO DE TEAM (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/services/team/team.service.ts
 * Camada de Defesa: C3 (RBAC) + C4 (ABAC) + C12 (Auditoria)
 * ============================================================================
 */

import { db } from "@/lib/db";
import type { Prisma, Team } from "@prisma/client";
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
  CreateTeamInput,
  UpdateTeamInput,
} from "@/lib/security/utils/validations.roster";

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

function teamSnapshot(t: Team) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    shortName: t.shortName,
    isActive: t.isActive,
    homeVenueId: t.homeVenueId,
  };
}

async function assertSlugAvailable(
  slug: string,
  excludeId?: string,
): Promise<void> {
  const existing = await db.team.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new LeagueConflictError(
      `Já existe um time usando o slug "${slug}" (${existing.name}).`,
      "SLUG_ALREADY_EXISTS",
    );
  }
}

// ============================================================================
// 1. CREATE
// ============================================================================

export async function createTeam(
  input: CreateTeamInput,
  actor: ActorContext,
): Promise<Team> {
  await assertSlugAvailable(input.slug);

  if (input.homeVenueId) {
    const venue = await db.venue.findUnique({
      where: { id: input.homeVenueId },
    });
    if (!venue) throw new NotFoundError("Local (Venue) não encontrado.");
  }

  // Construção condicional respeitando exactOptionalPropertyTypes: true
  const data: Prisma.TeamUncheckedCreateInput = {
    name: input.name,
    slug: input.slug,
    isActive: true, // Nasce ativo por padrão
  };

  if (input.shortName !== undefined) data.shortName = input.shortName;
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
  if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl;
  if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
  if (input.secondaryColor !== undefined)
    data.secondaryColor = input.secondaryColor;
  if (input.presidentName !== undefined)
    data.presidentName = input.presidentName;
  if (input.presidentPhotoUrl !== undefined)
    data.presidentPhotoUrl = input.presidentPhotoUrl;
  if (input.foundedYear !== undefined) data.foundedYear = input.foundedYear;
  if (input.homeVenueId !== undefined) data.homeVenueId = input.homeVenueId;

  if (input.description !== undefined) {
    data.description = input.description
      ? sanitizePlainText(input.description, 2000)
      : null;
  }

  const created = await db.team.create({ data });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_CREATE,
    entity: "Team",
    entityId: created.id,
    before: null,
    after: teamSnapshot(created),
    ip: actor.ip ?? null,
  });

  return created;
}

// ============================================================================
// 2. UPDATE
// ============================================================================

export async function updateTeam(
  id: string,
  patch: UpdateTeamInput,
  actor: ActorContext,
): Promise<Team> {
  const current = await db.team.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Time não encontrado.");

  if (patch.slug !== undefined && patch.slug !== current.slug) {
    await assertSlugAvailable(patch.slug, id);
  }

  if (patch.homeVenueId && patch.homeVenueId !== current.homeVenueId) {
    const venue = await db.venue.findUnique({
      where: { id: patch.homeVenueId },
    });
    if (!venue) throw new NotFoundError("Local (Venue) não encontrado.");
  }

  // Alterado de TeamUpdateInput para TeamUncheckedUpdateInput para acessar FKs diretas
  const data: Prisma.TeamUncheckedUpdateInput = {};

  if (patch.name !== undefined) data.name = patch.name;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.shortName !== undefined) data.shortName = patch.shortName;
  if (patch.logoUrl !== undefined) data.logoUrl = patch.logoUrl;
  if (patch.bannerUrl !== undefined) data.bannerUrl = patch.bannerUrl;
  if (patch.primaryColor !== undefined) data.primaryColor = patch.primaryColor;
  if (patch.secondaryColor !== undefined)
    data.secondaryColor = patch.secondaryColor;
  if (patch.presidentName !== undefined)
    data.presidentName = patch.presidentName;
  if (patch.presidentPhotoUrl !== undefined)
    data.presidentPhotoUrl = patch.presidentPhotoUrl;
  if (patch.foundedYear !== undefined) data.foundedYear = patch.foundedYear;
  if (patch.homeVenueId !== undefined) data.homeVenueId = patch.homeVenueId;

  if (patch.description !== undefined) {
    data.description = patch.description
      ? sanitizePlainText(patch.description, 2000)
      : null;
  }

  const updated = await db.team.update({ where: { id }, data });

  const warnings: string[] = [];
  if (patch.slug !== undefined && patch.slug !== current.slug) {
    warnings.push(
      "Slug alterado. URLs antigas que apontavam para este time irão quebrar.",
    );
  }

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_UPDATE,
    entity: "Team",
    entityId: id,
    before: teamSnapshot(current),
    after: teamSnapshot(updated),
    ip: actor.ip ?? null,
    metadata: warnings.length > 0 ? { warnings } : undefined,
  });

  return updated;
}

// ============================================================================
// 3. DEACTIVATE / REACTIVATE
// ============================================================================

export async function deactivateTeam(
  id: string,
  actor: ActorContext,
): Promise<Team> {
  const current = await db.team.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          contracts: { where: { endDate: null } },
          homeMatches: {
            where: {
              status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] },
            },
          },
          awayMatches: {
            where: {
              status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] },
            },
          },
        },
      },
    },
  });

  if (!current) throw new NotFoundError("Time não encontrado.");
  if (!current.isActive) return current;

  const activeContracts = current._count.contracts;
  const pendingMatches =
    current._count.homeMatches + current._count.awayMatches;

  if (activeContracts > 0 || pendingMatches > 0) {
    throw new LeagueConflictError(
      `Não é possível desativar o time. Existem ${activeContracts} contrato(s) ativo(s) e ${pendingMatches} partida(s) pendente(s).`,
      "TEAM_HAS_ACTIVE_DEPENDENCIES",
    );
  }

  const updated = await db.team.update({
    where: { id },
    data: { isActive: false },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_DEACTIVATE,
    entity: "Team",
    entityId: id,
    before: { isActive: true },
    after: { isActive: false },
    ip: actor.ip ?? null,
  });

  return updated;
}

export async function reactivateTeam(
  id: string,
  actor: ActorContext,
): Promise<Team> {
  const current = await db.team.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Time não encontrado.");
  if (current.isActive) return current;

  const updated = await db.team.update({
    where: { id },
    data: { isActive: true },
  });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_REACTIVATE,
    entity: "Team",
    entityId: id,
    before: { isActive: false },
    after: { isActive: true },
    ip: actor.ip ?? null,
  });

  return updated;
}

// ============================================================================
// 4. READ (Admin & Público)
// ============================================================================

export async function getTeamById(id: string) {
  return db.team.findUnique({
    where: { id },
    include: {
      socialLinks: true,
      homeVenue: { select: { id: true, name: true, city: true } },
      contracts: {
        where: { endDate: null },
        include: {
          player: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              position: true,
              photoUrl: true,
            },
          },
        },
      },
    },
  });
}

export async function getTeamBySlug(slug: string) {
  return db.team.findUnique({
    where: { slug },
    include: {
      socialLinks: true,
      homeVenue: { select: { id: true, name: true, city: true } },
      contracts: {
        where: { endDate: null },
        include: {
          player: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              position: true,
              photoUrl: true,
              slug: true,
            },
          },
        },
      },
    },
  });
}

export interface ListTeamsQuery {
  isActive?: boolean;
  take: number;
  cursor?: string;
}

export async function listTeams(query: ListTeamsQuery) {
  const { isActive, take, cursor } = query;

  const where: Prisma.TeamWhereInput = {
    ...(isActive !== undefined && { isActive }),
  };

  const items = await db.team.findMany({
    where,
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0,
    orderBy: { name: "asc" },
  });

  let nextCursor: string | undefined;
  if (items.length > take) {
    const last = items.pop();
    nextCursor = last?.id;
  }

  return { items, nextCursor };
}

// ============================================================================
// 5. DELETE (Hard Delete - SUPER_ADMIN)
// ============================================================================

export async function deleteTeam(
  id: string,
  actor: ActorContext,
): Promise<void> {
  const current = await db.team.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          contracts: true,
          homeMatches: true,
          awayMatches: true,
          standings: true,
          teamGroups: true,
          products: true,
          sponsors: true,
          draftPicks: true,
          eventRegistrations: true,
          awards: true,
        },
      },
    },
  });

  if (!current) throw new NotFoundError("Time não encontrado.");

  const counts = current._count;
  const totalDependents =
    counts.contracts +
    counts.homeMatches +
    counts.awayMatches +
    counts.standings +
    counts.teamGroups +
    counts.products +
    counts.sponsors +
    counts.draftPicks +
    counts.eventRegistrations +
    counts.awards;

  if (totalDependents > 0) {
    throw new LeagueConflictError(
      `O time possui ${totalDependents} dependente(s) no banco de dados. Desative-o em vez de deletar.`,
      "TEAM_HAS_DEPENDENTS",
    );
  }

  const { _count, ...currentBase } = current;
  await db.team.delete({ where: { id } });

  await createAuditLog({
    userId: actor.userId,
    action: AUDIT_EVENTS.TEAM_DELETE,
    entity: "Team",
    entityId: id,
    before: teamSnapshot(currentBase),
    after: null,
    ip: actor.ip ?? null,
  });
}
