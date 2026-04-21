import { NextRequest, NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getMatchMvp, overrideMvp } from "@/lib/services/match/stats.service";
import { mvpOverrideSchema } from "@/lib/security/utils/validations.stats";
import { requireAuth } from "@/lib/security/guards/require-auth";
import { requireRole } from "@/lib/security/guards/require-role";
import { requireMatchStatus } from "@/lib/security/guards/require-match-status";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { Role, MatchStatus } from "@prisma/client";
import { z } from "zod";

// Validação estrita do path param
const paramSchema = z.object({
  id: z.string().uuid("ID de partida inválido."),
});

type RouteContext = { params: Promise<{ id: string }> };

// ==========================================
// GET - Retorna o MVP público da partida
// ==========================================
export const GET = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const resolvedParams = await ctx.params;
    const { id } = paramSchema.parse(resolvedParams);

    const mvp = await getMatchMvp(id);

    return NextResponse.json({
      success: true,
      data: mvp,
    });
  },
  { rateLimitBucket: "publicRead" },
);

// ==========================================
// POST - Override manual de MVP (Admin)
// ==========================================
export const POST = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    const resolvedParams = await ctx.params;
    const { id } = paramSchema.parse(resolvedParams);

    // 1. Autenticação e Autorização
    const session = await requireAuth();
    requireRole(Role.ADMIN); // Corrigido: apenas 1 argumento

    // 2. ABAC de Status: Garante que o jogo já acabou
    await requireMatchStatus(id, [MatchStatus.FINISHED]);

    // 3. Validação do Body e Extração de IP
    const body = await req.json();
    const input = validatePayload(mvpOverrideSchema, body);
    const ip = await getClientIp(); // Corrigido: 0 argumentos e async

    // 4. Montagem do contexto do Ator
    const actor = {
      userId: session.userId,
      role: session.role,
      ip,
    };

    // 5. Executa a mutação
    const newMvp = await overrideMvp(id, input.playerId, input.reason, actor);

    return NextResponse.json(
      {
        success: true,
        data: newMvp,
      },
      { status: 201 }, // 201 Created para mutações bem-sucedidas
    );
  },
  { rateLimitBucket: "adminWrite" },
);
