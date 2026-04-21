import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getMatchStats } from "@/lib/services/match/stats.service";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

// Validação estrita do path param
const paramSchema = z.object({
  id: z.string().uuid("ID de partida inválido."),
});

// Tipagem exata exigida pelo Next.js 15+ para os parâmetros da rota
type RouteContext = { params: Promise<{ id: string }> };

export const GET = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    // Next.js 16 exige await no params
    const resolvedParams = await ctx.params;

    // Valida se o formato do ID é seguro
    const { id } = paramSchema.parse(resolvedParams);

    // Chama a função de leitura
    const stats = await getMatchStats(id);

    return NextResponse.json({
      success: true,
      data: stats,
    });
  },
  { rateLimitBucket: "publicRead" },
);
