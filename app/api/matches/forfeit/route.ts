/**
 * ============================================================================
 * /api/matches/[id]/forfeit — POST (registrar W.O.)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → Zod → forfeitMatch
 *
 * Body: { loserSide: "HOME" | "AWAY", reason: string }
 *
 * Efeitos:
 *   - Status SCHEDULED → FORFEIT
 *   - Placar padrão 20x0 (time presente vence)
 *   - WinType = FORFEIT
 *   - Standings atualizados (W.O. conta como partida jogada)
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { forfeitMatch } from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

const forfeitSchema = z
  .object({
    loserSide: z.enum(["HOME", "AWAY"], {
      message: "loserSide deve ser HOME ou AWAY.",
    }),
    reason: z
      .string()
      .trim()
      .min(10, "O motivo do W.O. deve ter pelo menos 10 caracteres.")
      .max(500, "O motivo não pode exceder 500 caracteres."),
  })
  .strict();

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { loserSide, reason } = validatePayload(forfeitSchema, body);
    const ip = await getClientIp();

    const forfeited = await forfeitMatch(matchId, loserSide, reason, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(forfeited);
  },
  { rateLimitBucket: "adminWrite" },
);
