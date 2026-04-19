/**
 * ============================================================================
 * /api/phases/reorder — POST (reordenar fases de um split)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → Zod → reorderPhases
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { reorderPhasesSchema } from "@/lib/security/utils/validations.league";
import { reorderPhases } from "@/lib/services/league/phase.service";

export const POST = safeRoute(
  async (req: NextRequest) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(reorderPhasesSchema, body);
    const ip = await getClientIp();

    const reordered = await reorderPhases(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(reordered);
  },
  { rateLimitBucket: "adminWrite" },
);
