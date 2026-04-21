/**
 * ============================================================================
 * /api/splits/[id]/checkins — GET (listar check-ins do split)
 * ============================================================================
 * GET → authRead → requireRole(ADMIN) → listCheckIns
 *
 * Retorna lista de presenças registradas no escopo do split inteiro
 * (check-ins feitos com splitId, não vinculados a partida específica).
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
    const { id: splitId } = await ctx.params;

    const checkIns = await listCheckIns({ splitId });

    return NextResponse.json({
      splitId,
      total: checkIns.length,
      checkIns,
    });
  },
  { rateLimitBucket: "authRead" },
);
