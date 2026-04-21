// app/api/checkins/scan/route.ts

/**
 * ============================================================================
 * /api/checkins/scan — POST (check-in via QR do jogador)
 * ============================================================================
 * POST → qrValidation → CSRF → requireRole(SCOREKEEPER+) → Zod → scanCheckIn
 *
 * Body: { qrCode, matchId?, splitId?, notes? }
 * XOR obrigatório: matchId ou splitId (validado no Zod)
 *
 * Quem pode escanear:
 *   SCOREKEEPER (40+) — operador designado na partida
 *   ADMIN (50+) — qualquer contexto
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { scanCheckInSchema } from "@/lib/security/utils/validations.checkin";
import { scanCheckIn } from "@/lib/services/checkin/checkin.service";

export const POST = safeRoute(
  async (req: NextRequest) => {
    const session = await requireRole("SCOREKEEPER");
    const body = await req.json();
    const input = validatePayload(scanCheckInSchema, body);

    const checkIn = await scanCheckIn(
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
  { rateLimitBucket: "qrValidation" },
);
