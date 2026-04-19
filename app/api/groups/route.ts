/**
 * ============================================================================
 * /api/groups — GET (listar) + POST (criar)
 * ============================================================================
 * GET  → publicRead  → listGroups
 * POST → adminWrite  → CSRF → requireRole(ADMIN) → Zod → createGroup
 * ============================================================================
 */

import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  listGroupsQuerySchema,
  createGroupSchema,
} from "@/lib/security/utils/validations.league";
import { listGroups, createGroup } from "@/lib/services/league/group.service";

// ─────────────────────────────────────────────────────────
// GET /api/groups
// ─────────────────────────────────────────────────────────

export const GET = safeRoute(
  async (req) => {
    const { searchParams } = new URL(req.url);

    const query = validatePayload(listGroupsQuerySchema, {
      phaseId: searchParams.get("phaseId") ?? undefined,
      take: searchParams.get("take") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    const result = await listGroups(query);
    return NextResponse.json(result);
  },
  { rateLimitBucket: "publicRead" },
);

// ─────────────────────────────────────────────────────────
// POST /api/groups
// ─────────────────────────────────────────────────────────

export const POST = safeRoute(
  async (req) => {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const input = validatePayload(createGroupSchema, body);
    const ip = await getClientIp();

    const created = await createGroup(input, {
      userId: session.userId,
      role: session.role,
      ip,
    });

    return NextResponse.json(created, { status: 201 });
  },
  { rateLimitBucket: "adminWrite" },
);
