/**
 * ============================================================================
 * /api/splits/[id]/deactivate — POST (desativar split)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → deactivateSplit
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { deactivateSplit } from "@/lib/services/league/split.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const deactivated = await deactivateSplit(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(deactivated);
  },
  { rateLimitBucket: "adminWrite" },
);
