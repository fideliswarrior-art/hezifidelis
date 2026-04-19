/**
 * ============================================================================
 * /api/matches/[id]/events/[eventId]/void — POST (anular evento)
 * ============================================================================
 * POST → gameWrite → CSRF → requireAuth → Zod → voidEvent
 *
 * AUTORIZAÇÃO (verificada no service):
 *   - Criador do evento pode anular seu próprio lance
 *   - ADMIN+ pode anular qualquer lance
 *
 * Body: { voidReason: string } — mínimo 10 caracteres (validado pelo Zod)
 *
 * Efeitos:
 *   - MatchEvent.isVoided = true (soft-delete, nunca hard delete)
 *   - Placar recalculado ignorando o evento anulado
 *   - AuditLog gerado (ação sensível)
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireAuth } from "@/lib/security/guards/require-auth";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { voidEventSchema } from "@/lib/security/utils/validations.match";
import { voidEvent } from "@/lib/services/match/match-event.service";

type RouteContext = { params: Promise<{ id: string; eventId: string }> };

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId, eventId } = await ctx.params;
    const session = await requireAuth();
    const body = await req.json();
    const { voidReason } = validatePayload(voidEventSchema, body);
    const ip = await getClientIp();

    const voided = await voidEvent(matchId, eventId, voidReason, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(voided);
  },
  { rateLimitBucket: "gameWrite" },
);
