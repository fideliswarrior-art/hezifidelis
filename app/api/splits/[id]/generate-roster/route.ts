/**
 * ============================================================================
 * /api/splits/[id]/generate-roster — POST (gerar snapshot de elenco)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → generateRosterSnapshot
 *
 * Idempotente: pode ser chamado múltiplas vezes. Limpa snapshots órfãos
 * e recria/atualiza baseado nos contratos ativos do Split.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { generateRosterSnapshot } from "@/lib/services/player/roster.service";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id: splitId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const ip = await getClientIp();

    const result = await generateRosterSnapshot(splitId, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(result);
  },
  { rateLimitBucket: "adminWrite" },
);
