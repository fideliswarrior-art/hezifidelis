/**
 * ============================================================================
 * /api/teams — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listTeams
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createTeam
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { createTeamSchema } from "@/lib/security/utils/validations.roster";
import {
  listTeams,
  createTeam,
  type ListTeamsQuery,
} from "@/lib/services/team/team.service";

// ─────────────────────────────────────────────────────────
// GET /api/teams
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const cursor = searchParams.get("cursor");
    const isActiveParam = searchParams.get("isActive");

    const query: ListTeamsQuery = {
      take: Math.min(Number(searchParams.get("take") ?? 50), 100),
      // O spread operator adiciona a chave apenas se a condição for verdadeira,
      // omitindo a propriedade completamente em vez de passar 'undefined'
      ...(cursor ? { cursor } : {}),
      ...(isActiveParam !== null ? { isActive: isActiveParam === "true" } : {}),
    };

    const result = await listTeams(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/teams
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createTeamSchema, body);
    const ip = await getClientIp();

    const created = await createTeam(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
