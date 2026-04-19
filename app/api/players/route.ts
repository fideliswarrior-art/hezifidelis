/**
 * ============================================================================
 * /api/players — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listPlayers
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createPlayer
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { createPlayerSchema } from "@/lib/security/utils/validations.roster";
import {
  listPlayers,
  createPlayer,
  type ListPlayersQuery,
} from "@/lib/services/player/player.service";
import type { PlayerStatus, Position } from "@prisma/client";

// ─────────────────────────────────────────────────────────
// GET /api/players
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const cursor = searchParams.get("cursor");
    const status = searchParams.get("status");
    const position = searchParams.get("position");
    const teamId = searchParams.get("teamId");

    const query: ListPlayersQuery = {
      take: Math.min(Number(searchParams.get("take") ?? 50), 100),
      ...(cursor ? { cursor } : {}),
      ...(status ? { status: status as PlayerStatus } : {}),
      ...(position ? { position: position as Position } : {}),
      ...(teamId ? { teamId } : {}),
    };

    const result = await listPlayers(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/players
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createPlayerSchema, body);
    const ip = await getClientIp();

    const created = await createPlayer(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
