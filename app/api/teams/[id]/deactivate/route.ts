/**
 * ============================================================================
 * /api/teams/[id]/deactivate — POST (desativar time)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → deactivateTeam
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { deactivateTeam } from "@/lib/services/team/team.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const deactivated = await deactivateTeam(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(deactivated);
  },
  { rateLimitBucket: "adminWrite" },
);
