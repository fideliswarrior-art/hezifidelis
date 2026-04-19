/**
 * ============================================================================
 * /api/matches — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listMatches
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createMatch
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  listMatchesQuerySchema,
  createMatchSchema,
} from "@/lib/security/utils/validations.match";
import { listMatches, createMatch } from "@/lib/services/match/match.service";

// ─────────────────────────────────────────────────────────
// GET /api/matches
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// GET /api/matches
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    // Converte os params da URL em um objeto limpo (ignora undefineds implicitamente)
    const rawQuery = Object.fromEntries(searchParams.entries());

    // Deixa o Zod parsear/converter (o schema listMatchesQuerySchema deve ter z.coerce.number/date quando necessário)
    const query = validatePayload(listMatchesQuerySchema, rawQuery);

    const result = await listMatches(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/matches
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createMatchSchema, body);
    const ip = await getClientIp();

    const created = await createMatch(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
