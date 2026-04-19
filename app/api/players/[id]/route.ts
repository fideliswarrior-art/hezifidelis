/**
 * ============================================================================
 * /api/players/[id] — GET (detalhe) + PATCH (atualizar) + DELETE (remover)
 * ============================================================================
 * GET    → publicRead  → getPlayerById
 * PATCH  → adminWrite  → CSRF → requireRole(ADMIN) → Zod → updatePlayer
 * DELETE → adminWrite  → CSRF → requireRole(SUPER_ADMIN) → deletePlayer
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updatePlayerSchema } from "@/lib/security/utils/validations.roster";
import {
  getPlayerById,
  updatePlayer,
  deletePlayer,
} from "@/lib/services/player/player.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/players/[id]
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;

    const player = await getPlayerById(id);
    if (!player) {
      return NextResponse.json(
        { error: "Jogador não encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json(player);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/players/[id]
// ─────────────────────────────────────────────────────────

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updatePlayerSchema, body);
    const ip = await getClientIp();

    const updated = await updatePlayer(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/players/[id] — SUPER_ADMIN only
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("SUPER_ADMIN");
    const ip = await getClientIp();

    await deletePlayer(id, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
