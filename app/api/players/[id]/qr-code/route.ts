/**
 * ============================================================================
 * /api/players/[id]/qr-code — POST (gerar/regenerar) + GET (imagem)
 * ============================================================================
 * POST → adminWrite → CSRF → requireRole(ADMIN) → generatePlayerQrCode
 * GET  → adminWrite → requireRole(ADMIN) → retorna imagem do QR atual
 *
 * POST é idempotente no sentido de sempre gerar um QR novo.
 * Regenerar invalida o QR anterior instantaneamente.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { generatePlayerQrCode } from "@/lib/services/player/player.service";
import { db } from "@/lib/db";
import { generateTicketQrImage } from "@/lib/security/crypto/qrcode";

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────
// POST /api/players/[id]/qr-code — Gerar/regenerar QR
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    const session = await requireRole("ADMIN");
    const { id: playerId } = await ctx.params;
    const ip = await getClientIp();

    const result = await generatePlayerQrCode(playerId, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(result, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);

// ─────────────────────────────────────────────────────────
// GET /api/players/[id]/qr-code — Consultar QR existente
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (_req: NextRequest, ctx: RouteContext) => {
    await requireRole("ADMIN");
    const { id: playerId } = await ctx.params;

    const player = await db.player.findUnique({
      where: { id: playerId },
      select: {
        checkInQrCode: true,
        checkInQrGeneratedAt: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!player) {
      return NextResponse.json(
        { error: "Jogador não encontrado." },
        { status: 404 },
      );
    }

    if (!player.checkInQrCode) {
      return NextResponse.json(
        { error: "QR ainda não foi gerado para este jogador." },
        { status: 404 },
      );
    }

    const qrImage = await generateTicketQrImage(player.checkInQrCode);

    return NextResponse.json({
      qrImage,
      generatedAt: player.checkInQrGeneratedAt,
      playerName: `${player.firstName} ${player.lastName}`,
    });
  },
  { rateLimitBucket: "adminWrite" },
);
