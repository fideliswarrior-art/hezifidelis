/**
 * ============================================================================
 * /api/players/[id]/contracts — GET (histórico) + POST (criar/transferir)
 * ============================================================================
 * GET  → authRead   → requireRole(ADMIN) → getContractHistory
 * POST → adminWrite → CSRF → requireRole(ADMIN) → Zod → createInitial | transfer
 *
 * O POST usa discriminated union no body:
 *   { isInitial: true, teamId, splitId, ... }  → createInitialContract
 *   { isTransfer: true, newTeamId, splitId, ... } → transferPlayer
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { contractActionSchema } from "@/lib/security/utils/validations.roster";
import {
  createInitialContract,
  transferPlayer,
  getContractHistory,
} from "@/lib/services/player/contract.service";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// GET /api/players/[id]/contracts — Histórico completo
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id: playerId } = await ctx.params;
    await requireRole("ADMIN");

    const history = await getContractHistory(playerId);
    return NextResponse.json(history);
  },
  { rateLimitBucket: "authRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/players/[id]/contracts — Criar ou transferir
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id: playerId } = await ctx.params;
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(contractActionSchema, body);
    const ip = await getClientIp();

    const actor = {
      userId: session.userId,
      role: session.role,
      ip,
    };

    let contract;

    if ("isInitial" in input && input.isInitial) {
      contract = await createInitialContract(
        playerId,
        {
          teamId: input.teamId,
          splitId: input.splitId,
          jerseyNumber: input.jerseyNumber,
          startDate: input.startDate,
        },
        actor,
      );
    } else if ("isTransfer" in input && input.isTransfer) {
      contract = await transferPlayer(
        playerId,
        {
          newTeamId: input.newTeamId,
          splitId: input.splitId,
          jerseyNumber: input.jerseyNumber,
          startDate: input.startDate,
          // Inclui 'transferFee' apenas se não for undefined.
          // Usamos '!== undefined' em vez de apenas 'input.transferFee'
          // para garantir que o valor 0 (zero) seja aceito caso a transferência seja gratuita.
          ...(input.transferFee !== undefined
            ? { transferFee: input.transferFee }
            : {}),
        },
        actor,
      );
    }

    return NextResponse.json(contract, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
