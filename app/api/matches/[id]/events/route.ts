/**
 * ============================================================================
 * /api/matches/[id]/events — GET (listar) + POST (registrar lance)
 * ============================================================================
 * GET  → publicRead → getEventsForMatch
 * POST → gameWrite  → CSRF → requireMatchOfficial OR requireRole(ADMIN)
 *        → Zod → registerEvent
 *
 * POST é a rota mais chamada durante o torneio (200+ vezes por partida).
 * Rate limit: gameWrite (60 req/min por userId).
 *
 * AUTORIZAÇÃO ABAC:
 *   - SCOREKEEPER/REFEREE designado na partida (via requireMatchOfficial)
 *   - ADMIN+ pode registrar em bypass (auditado com isBypass)
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireAuth } from "@/lib/security/guards/require-auth";
import { requireMatchOfficial } from "@/lib/security/guards/require-match-official";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { registerEventSchema } from "@/lib/security/utils/validations.match";
import {
  registerEvent,
  getEventsForMatch,
} from "@/lib/services/match/match-event.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/matches/[id]/events — Lista de eventos
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const { searchParams } = new URL(req.url);

    const includeVoided = searchParams.get("includeVoided") === "true";

    const events = await getEventsForMatch(matchId, { includeVoided });
    return NextResponse.json(events);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/matches/[id]/events — Registrar lance ao vivo
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;

    // 1. Autenticação — obtém session com userId e role
    const session = await requireAuth();

    // 2. Autorização ABAC — mesário designado OU ADMIN+ bypass
    //    Lança MatchOfficialError (403) se não autorizado
    await requireMatchOfficial(session, matchId);

    // 3. Input validado
    const body = await req.json();
    const input = validatePayload(registerEventSchema, body);
    const ip = await getClientIp();

    // 4. Registro do evento — userId/role vêm da session autenticada
    const event = await registerEvent(matchId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(event, { status: 201 });
  },
  { rateLimitBucket: "gameWrite" },
);
