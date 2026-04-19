/**
 * ============================================================================
 * /api/players/[id]/status — PATCH (alterar status via state machine)
 * ============================================================================
 * PATCH → adminWrite → CSRF → requireRole(ADMIN) → Zod → updatePlayerStatus
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { updatePlayerStatusSchema } from "@/lib/security/utils/validations.roster";
import { updatePlayerStatus } from "@/lib/services/player/player.service";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(updatePlayerStatusSchema, body);
    const ip = await getClientIp();

    const updated = await updatePlayerStatus(id, input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(updated);
  },
  { rateLimitBucket: "adminWrite" },
);
