/**
 * ============================================================================
 * /api/seasons/[id] — GET (detalhe) + PATCH (atualizar)
 * ============================================================================
 * GET   → publicRead  → getSeasonById
 * PATCH → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updateSeason
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updateSeasonSchema } from "@/lib/security/utils/validations.league";
import {
  getSeasonById,
  updateSeason,
} from "@/lib/services/league/season.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/seasons/[id] — Detalhe público
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const season = await getSeasonById(id);
    if (!season) {
      return NextResponse.json(
        { error: "Season não encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json(season);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/seasons/[id] — Atualizar metadados (ADMIN+)
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updateSeasonSchema, body);
    const ip = await getClientIp();

    const updated = await updateSeason(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);
