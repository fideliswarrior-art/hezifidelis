/**
 * ============================================================================
 * /api/splits — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listSplits
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createSplit
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  listSplitsQuerySchema,
  createSplitSchema,
} from "@/lib/security/utils/validations.league";
import { listSplits, createSplit } from "@/lib/services/league/split.service";

// ─────────────────────────────────────────────────────────
// GET /api/splits
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const query = validatePayload(listSplitsQuerySchema, {
      seasonId: searchParams.get("seasonId") ?? undefined,
      type: searchParams.get("type") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
      take: searchParams.get("take") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    const result = await listSplits(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/splits
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createSplitSchema, body);
    const ip = await getClientIp();

    const created = await createSplit(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
