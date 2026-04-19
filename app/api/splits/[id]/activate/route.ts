/**
 * ============================================================================
 * /api/splits/[id]/activate — POST (ativar split)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → activateSplit
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { activateSplit } from "@/lib/services/league/split.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const activated = await activateSplit(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(activated);
  },
  { rateLimitBucket: "adminWrite" },
);
