import { NextRequest, NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getPlayerStats } from "@/lib/services/match/stats.service";
import { playerStatsQuerySchema } from "@/lib/security/utils/validations.stats";
import { z } from "zod";

// Validação estrita do path param
const paramSchema = z.object({
  id: z.string().uuid("ID de jogador inválido."),
});

type RouteContext = { params: Promise<{ id: string }> };

export const GET = safeRoute(
  async (req: NextRequest, ctx: RouteContext) => {
    // 1. Resolve e valida os parâmetros de rota (ID do jogador)
    const resolvedParams = await ctx.params;
    const { id } = paramSchema.parse(resolvedParams);

    // 2. Extrai e valida os query params (filtros opcionais)
    const searchParams = req.nextUrl.searchParams;
    const query = {
      splitId: searchParams.get("splitId") || undefined,
      seasonId: searchParams.get("seasonId") || undefined,
    };

    // Passa pelo schema Zod que criamos
    const filters = playerStatsQuerySchema.parse(query);

    // 3. Aplica o spread condicional para evitar o erro do exactOptionalPropertyTypes
    const cleanFilters = {
      ...(filters.splitId && { splitId: filters.splitId }),
      ...(filters.seasonId && { seasonId: filters.seasonId }),
    };

    // 4. Busca as estatísticas agregadas no serviço
    const stats = await getPlayerStats(id, cleanFilters);

    // 5. Retorno padronizado
    return NextResponse.json({
      success: true,
      data: stats,
    });
  },
  { rateLimitBucket: "publicRead" },
);
