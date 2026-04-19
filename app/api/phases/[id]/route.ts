/**
 * ============================================================================
 * /api/phases/[id] — GET (detalhe) + PATCH (atualizar) + DELETE (remover)
 * ============================================================================
 * GET    → publicRead  → getPhaseById
 * PATCH  → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updatePhase
 * DELETE → adminWrite  → CSRF → requireRole(ADMIN) → deletePhase
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updatePhaseSchema } from "@/lib/security/utils/validations.league";
import {
  getPhaseById,
  updatePhase,
  deletePhase,
} from "@/lib/services/league/phase.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/phases/[id]
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const phase = await getPhaseById(id);
    if (!phase) {
      return NextResponse.json(
        { error: "Phase não encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json(phase);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/phases/[id]
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updatePhaseSchema, body);
    const ip = await getClientIp();

    const updated = await updatePhase(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/phases/[id]
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    await deletePhase(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
