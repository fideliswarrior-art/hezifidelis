/**
 * ============================================================================
 * /api/matches/[id]/finish — POST (finalizar partida)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → finishMatch
 *
 * Efeitos atômicos:
 *   1. Calcula placar final a partir dos MatchEvents
 *   2. Status LIVE → FINISHED, finishedAt = now()
 *   3. Atualiza MatchPeriods com placares por período
 *   4. Recalcula MatchStat por jogador (E3.4)
 *   5. Atualiza Standings split-level + group-level (E3.4)
 *   6. Computa MVP por P-VAL se isOfficial (E3.4)
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { finishMatch } from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const finished = await finishMatch(matchId, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(finished);
  },
  { rateLimitBucket: "adminWrite" },
);
