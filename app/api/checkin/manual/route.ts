/**
 * ============================================================================
 * /api/checkins/manual — POST (check-in manual sem QR)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → Zod → manualCheckIn
 *
 * Body: { playerId, matchId?, splitId?, notes? }
 * XOR obrigatório: matchId ou splitId (validado no Zod)
 *
 * Uso: admin registra presença de jogador que não tem QR impresso
 * ou que esqueceu o cartão. Apenas ADMIN+ pode usar.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { manualCheckInSchema } from "@/lib/security/utils/validations.checkin";
import { manualCheckIn } from "@/lib/services/checkin/checkin.service";

export const POST = safeRoute(
  async (req: NextRequest) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(manualCheckInSchema, body);

    const checkIn = await manualCheckIn(
      { userId: session.userId, role: session.role },
      input,
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          id: checkIn.id,
          playerName: `${checkIn.player.firstName} ${checkIn.player.lastName}`,
          checkedInAt: checkIn.checkedInAt,
          method: checkIn.method,
        },
      },
      { status: 201 },
    );
  },
  { rateLimitBucket: "adminWrite" },
);
