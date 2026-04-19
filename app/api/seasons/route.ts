/**
 * ============================================================================
 * /api/seasons — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listSeasons
 * POST → adminWrite  → CSRF → requireAuth → requireRole(ADMIN) → Zod → createSeason
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  listSeasonsQuerySchema,
  createSeasonSchema,
} from "@/lib/security/utils/validations.league";
import {
  listSeasons,
  createSeason,
} from "@/lib/services/league/season.service";

// ─────────────────────────────────────────────────────────
// GET /api/seasons — Listagem pública
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const query = validatePayload(listSeasonsQuerySchema, {
      year: searchParams.get("year") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
      slug: searchParams.get("slug") ?? undefined,
      take: searchParams.get("take") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    const result = await listSeasons(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/seasons — Criar season (ADMIN+)
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createSeasonSchema, body);
    const ip = await getClientIp();

    const created = await createSeason(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
