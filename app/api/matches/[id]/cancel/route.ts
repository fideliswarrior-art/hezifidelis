/**
 * ============================================================================
 * /api/matches/[id]/cancel — POST (cancelar partida)
 * ============================================================================
 * POST → adminWrite → CSRF → auth → cancelMatch
 *
 * CONTROLE DE ACESSO DIFERENCIADO:
 *   - SCHEDULED → CANCELED: ADMIN+ pode cancelar
 *   - LIVE → CANCELED: apenas SUPER_ADMIN (emergência)
 *
 * O service valida a state machine. A rota valida o nível de acesso
 * baseado no status atual da partida.
 *
 * Body: { reason: string } — motivo obrigatório (min 10 chars)
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MatchStatus } from "@prisma/client";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/security/utils/errors";
import { cancelMatch } from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

const cancelSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, "O motivo do cancelamento deve ter pelo menos 10 caracteres.")
      .max(500, "O motivo não pode exceder 500 caracteres."),
  })
  .strict();

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;

    // Busca status atual para determinar nível de acesso exigido
    const match = await db.match.findUnique({
      where: { id: matchId },
      select: { status: true },
    });

    if (!match) throw new NotFoundError("Partida não encontrada.");

    // LIVE → CANCELED exige SUPER_ADMIN (emergência)
    const session =
      match.status === MatchStatus.LIVE
        ? await requireRole("SUPER_ADMIN")
        : await requireRole("ADMIN");

    const body = await req.json();
    const { reason } = validatePayload(cancelSchema, body);
    const ip = await getClientIp();

    const canceled = await cancelMatch(matchId, reason, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(canceled);
  },
  { rateLimitBucket: "adminWrite" },
);
