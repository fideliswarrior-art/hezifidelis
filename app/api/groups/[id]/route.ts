/**
 * ============================================================================
 * /api/groups/[id] — GET (detalhe) + PATCH (atualizar) + DELETE (remover)
 * ============================================================================
 * GET    → publicRead  → getGroupById
 * PATCH  → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updateGroup
 * DELETE → adminWrite  → CSRF → requireRole(ADMIN) → deleteGroup
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updateGroupSchema } from "@/lib/security/utils/validations.league";
import {
  getGroupById,
  updateGroup,
  deleteGroup,
} from "@/lib/services/league/group.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/groups/[id]
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const group = await getGroupById(id);
    if (!group) {
      return NextResponse.json(
        { error: "Grupo não encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json(group);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/groups/[id]
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updateGroupSchema, body);
    const ip = await getClientIp();

    const updated = await updateGroup(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/groups/[id]
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    await deleteGroup(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
