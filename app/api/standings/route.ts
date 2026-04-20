import { NextRequest, NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getStandings } from "@/lib/services/match/stats.service";
import { standingsQuerySchema } from "@/lib/security/utils/validations.stats";

export const GET = safeRoute(
  async (req: NextRequest) => {
    // 1. Extrai os query params da URL
    const searchParams = req.nextUrl.searchParams;
    const query = {
      splitId: searchParams.get("splitId") || undefined,
      groupId: searchParams.get("groupId") || undefined,
    };

    // 2. Valida usando o schema Zod (que garante que ao menos um foi passado)
    const filters = standingsQuerySchema.parse(query);

    // 3. Aplica o spread condicional para evitar o erro do exactOptionalPropertyTypes
    const cleanFilters = {
      ...(filters.splitId && { splitId: filters.splitId }),
      ...(filters.groupId && { groupId: filters.groupId }),
    };

    // 4. Busca a tabela de classificação ordenada no serviço
    const standings = await getStandings(cleanFilters);

    // 5. Retorna no padrão da API
    return NextResponse.json({
      success: true,
      data: standings,
    });
  },
  { rateLimitBucket: "publicRead" },
);
