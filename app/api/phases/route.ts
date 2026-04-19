/**
 * ============================================================================
 * /api/phases — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listPhases
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createPhase
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  listPhasesQuerySchema,
  createPhaseSchema,
} from "@/lib/security/utils/validations.league";
import { listPhases, createPhase } from "@/lib/services/league/phase.service";

// ─────────────────────────────────────────────────────────
// GET /api/phases
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const query = validatePayload(listPhasesQuerySchema, {
      splitId: searchParams.get("splitId") ?? undefined,
      type: searchParams.get("type") ?? undefined,
      take: searchParams.get("take") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    const result = await listPhases(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/phases
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createPhaseSchema, body);
    const ip = await getClientIp();

    const created = await createPhase(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
