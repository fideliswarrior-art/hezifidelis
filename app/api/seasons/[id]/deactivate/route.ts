/**
 * ============================================================================
 * /api/seasons/[id]/deactivate — POST (desativar season)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → deactivateSeason
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { deactivateSeason } from "@/lib/services/league/season.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const deactivated = await deactivateSeason(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(deactivated);
  },
  { rateLimitBucket: "adminWrite" },
);
