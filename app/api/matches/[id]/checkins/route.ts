/**
 * ============================================================================
 * /api/matches/[id]/checkins — GET (listar check-ins da partida)
 * ============================================================================
 * GET → authRead → requireRole(ADMIN) → listCheckIns
 *
 * Retorna lista de presenças com dados do jogador e operador.
 * IP mascarado (LGPD). Apenas ADMIN+ pode consultar.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { listCheckIns } from "@/lib/services/checkin/checkin.service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    await requireRole("ADMIN");
    const { id: matchId } = await ctx.params;

    const checkIns = await listCheckIns({ matchId });

    return NextResponse.json({
      matchId,
      total: checkIns.length,
      checkIns,
    });
  },
  { rateLimitBucket: "authRead" },
);
