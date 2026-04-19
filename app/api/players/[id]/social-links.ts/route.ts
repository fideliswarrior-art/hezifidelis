/**
 * ============================================================================
 * /api/players/[id]/social-links — POST (upsert) + DELETE (remover)
 * ============================================================================
 * POST   → adminWrite → CSRF → requireRole(ADMIN) → Zod → upsertPlayerSocialLink
 * DELETE → adminWrite → CSRF → requireRole(ADMIN) → Zod → removePlayerSocialLink
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  upsertSocialLinkSchema,
  removeSocialLinkSchema,
} from "@/lib/security/utils/validations.roster";
import {
  upsertPlayerSocialLink,
  removePlayerSocialLink,
} from "@/lib/services/player/player-social.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// POST /api/players/[id]/social-links — Adicionar ou atualizar
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: playerId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(upsertSocialLinkSchema, body);
    const ip = await getClientIp();

    const result = await upsertPlayerSocialLink(playerId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(result);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/players/[id]/social-links — Remover rede social
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: playerId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(removeSocialLinkSchema, body);
    const ip = await getClientIp();

    await removePlayerSocialLink(playerId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
