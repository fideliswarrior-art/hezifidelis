/**
 * ============================================================================
 * /api/contracts/[id]/close — POST (encerrar contrato)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → Zod → closeContract
 *
 * Body: { reason: "RETIRED" | "RELEASED" | "INJURED_LONG" }
 *
 * REGRAS (aplicadas no service):
 *   RETIRED     → fecha TODOS os contratos ativos + status RETIRED
 *   RELEASED    → fecha ESTE contrato + status FREE_AGENT (se sem outros)
 *   INJURED_LONG → fecha ESTE contrato + status INJURED
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { closeContractSchema } from "@/lib/security/utils/validations.roster";
import { closeContract } from "@/lib/services/player/contract.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: contractId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { reason } = validatePayload(closeContractSchema, body);
    const ip = await getClientIp();

    const closed = await closeContract(contractId, reason, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(closed);
  },
  { rateLimitBucket: "adminWrite" },
);
