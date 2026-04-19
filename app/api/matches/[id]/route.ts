/**
 * ============================================================================
 * /api/matches/[id] — GET (detalhe completo)
 * ============================================================================
 * GET → publicRead → getMatchById
 *
 * Inclui: times, venue, oficiais, períodos, MVP.
 * Não há PATCH — partidas são modificadas via lifecycle endpoints
 * (/start, /finish, /cancel, /postpone, /forfeit).
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getMatchById } from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json(
        { error: "Partida não encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json(match);
  },
  { rateLimitBucket: "publicRead" },
);
