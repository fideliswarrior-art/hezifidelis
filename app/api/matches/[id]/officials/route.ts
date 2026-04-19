/**
 * ============================================================================
 * /api/matches/[id]/officials — POST (designar) + DELETE (remover)
 * ============================================================================
 * POST   → adminWrite → CSRF → requireRole(ADMIN) → Zod → assignOfficial
 * DELETE → adminWrite → CSRF → requireRole(ADMIN) → Zod → removeOfficial
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  assignOfficialSchema,
  removeOfficialSchema,
} from "@/lib/security/utils/validations.match";
import {
  assignOfficial,
  removeOfficial,
} from "@/lib/services/match/match.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// POST /api/matches/[id]/officials — Designar oficial
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(assignOfficialSchema, body);
    const ip = await getClientIp();

    const official = await assignOfficial(matchId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(official, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/matches/[id]/officials — Remover oficial
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: matchId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(removeOfficialSchema, body);
    const ip = await getClientIp();

    await removeOfficial(matchId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
