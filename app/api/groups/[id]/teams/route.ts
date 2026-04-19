/**
 * ============================================================================
 * /api/groups/[id]/teams — POST (associar time) + DELETE (remover time)
 * ============================================================================
 * POST   → adminWrite → CSRF → requireRole(ADMIN) → Zod → assignTeamToGroup
 * DELETE → adminWrite → CSRF → requireRole(ADMIN) → Zod → removeTeamFromGroup
 *
 * O groupId vem do path param. O teamId vem do body.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  assignTeamToGroup,
  removeTeamFromGroup,
} from "@/lib/services/league/group.service";

type RouteContext = { params: Promise<{ id: string }> };

/** Body schema — apenas teamId; groupId vem do path. */
const teamBodySchema = z
  .object({
    teamId: z.string().uuid("teamId inválido."),
  })
  .strict();

// ─────────────────────────────────────────────────────────
// POST /api/groups/[id]/teams — Associar time ao grupo
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: groupId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { teamId } = validatePayload(teamBodySchema, body);
    const ip = await getClientIp();

    const result = await assignTeamToGroup(
      { teamId, groupId },
      { userId: session.userId, role: session.role, ip },
    );

    return NextResponse.json(result, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/groups/[id]/teams — Remover time do grupo
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: groupId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { teamId } = validatePayload(teamBodySchema, body);
    const ip = await getClientIp();

    await removeTeamFromGroup(
      { teamId, groupId },
      { userId: session.userId, role: session.role, ip },
    );

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
