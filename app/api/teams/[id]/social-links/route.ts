/**
 * ============================================================================
 * /api/teams/[id]/social-links — POST (upsert) + DELETE (remover)
 * ============================================================================
 * POST   → adminWrite → CSRF → requireRole(ADMIN) → Zod → upsertTeamSocialLink
 * DELETE → adminWrite → CSRF → requireRole(ADMIN) → Zod → removeTeamSocialLink
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
  upsertTeamSocialLink,
  removeTeamSocialLink,
} from "@/lib/services/team/team-social.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// POST /api/teams/[id]/social-links — Adicionar ou atualizar
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: teamId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(upsertSocialLinkSchema, body);
    const ip = await getClientIp();

    const result = await upsertTeamSocialLink(teamId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(result);
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// DELETE /api/teams/[id]/social-links — Remover rede social
// ─────────────────────────────────────────────────────────

export const DELETE = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: teamId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(removeSocialLinkSchema, body);
    const ip = await getClientIp();

    await removeTeamSocialLink(teamId, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  },
  { rateLimitBucket: "adminWrite" },
);
