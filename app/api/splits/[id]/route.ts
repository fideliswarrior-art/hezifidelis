/**
 * ============================================================================
 * /api/splits/[id] — GET (detalhe) + PATCH (atualizar)
 * ============================================================================
 * GET   → publicRead  → getSplitById
 * PATCH → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updateSplit
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updateSplitSchema } from "@/lib/security/utils/validations.league";
import { getSplitById, updateSplit } from "@/lib/services/league/split.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/splits/[id]
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const split = await getSplitById(id);
    if (!split) {
      return NextResponse.json(
        { error: "Split não encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json(split);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/splits/[id]
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updateSplitSchema, body);
    const ip = await getClientIp();

    const updated = await updateSplit(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);
