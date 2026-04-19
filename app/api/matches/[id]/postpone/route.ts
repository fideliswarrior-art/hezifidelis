/**
 * ============================================================================
 * /api/matches/[id]/postpone — POST (adiar) + PATCH (reagendar)
 * ============================================================================
 * POST  → adminWrite → CSRF → requireRole(ADMIN) → postponeMatch
 * PATCH → adminWrite → CSRF → requireRole(ADMIN) → Zod → rescheduleMatch
 *
 * POST  = SCHEDULED → POSTPONED (adiar sem nova data)
 * PATCH = POSTPONED → SCHEDULED (reagendar com nova data)
 *
 * Body POST:  { reason: string }
 * Body PATCH: { newDate: ISO datetime }
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  postponeMatch,
  rescheduleMatch,
} from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

const postponeSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, "O motivo do adiamento deve ter pelo menos 10 caracteres.")
      .max(500, "O motivo não pode exceder 500 caracteres."),
  })
  .strict();

const rescheduleSchema = z
  .object({
    newDate: z.coerce.date({
      message: "Data de reagendamento inválida.",
    }),
  })
  .strict();

// ─────────────────────────────────────────────────────────
// POST /api/matches/[id]/postpone — Adiar partida
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { reason } = validatePayload(postponeSchema, body);
    const ip = await getClientIp();

    const postponed = await postponeMatch(matchId, reason, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(postponed);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/matches/[id]/postpone — Reagendar partida adiada
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { newDate } = validatePayload(rescheduleSchema, body);
    const ip = await getClientIp();

    const rescheduled = await rescheduleMatch(matchId, newDate, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(rescheduled);
  },
  { rateLimitBucket: "adminWrite" },
);
