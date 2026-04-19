/**
 * ============================================================================
 * /api/matches/[id]/start — POST (iniciar partida)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → startMatch
 *
 * Efeitos:
 *   - Status SCHEDULED → LIVE
 *   - startedAt = now()
 *   - MatchPeriod 1 criado automaticamente
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { startMatch } from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const started = await startMatch(matchId, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(started);
  },
  { rateLimitBucket: "adminWrite" },
);
