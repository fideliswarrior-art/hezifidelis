/**
 * ============================================================================
 * /api/teams/[id] — GET (detalhe) + PATCH (atualizar) + DELETE (remover)
 * ============================================================================
 * GET    → publicRead  → getTeamById
 * PATCH  → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updateTeam
 * DELETE → adminWrite  → CSRF → requireRole(SUPER_ADMIN) → deleteTeam
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updateTeamSchema } from "@/lib/security/utils/validations.roster";
import {
  getTeamById,
  updateTeam,
  deleteTeam,
} from "@/lib/services/team/team.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/teams/[id]
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const team = await getTeamById(id);
    if (!team) {
      return NextResponse.json(
        { error: "Time não encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json(team);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/teams/[id]
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updateTeamSchema, body);
    const ip = await getClientIp();

    const updated = await updateTeam(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/teams/[id] — SUPER_ADMIN only
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("SUPER_ADMIN");
    const ip = await getClientIp();

    await deleteTeam(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
