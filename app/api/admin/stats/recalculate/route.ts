import { NextRequest, NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireAuth } from "@/lib/security/guards/require-auth";
import { requireRole } from "@/lib/security/guards/require-role";
import { validatePayload } from "@/lib/security/utils/validate";
import { adminRecalculateSchema } from "@/lib/security/utils/validations.stats";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  recalculateSplitStandings,
  recalculateMatchStats,
  updateStandings,
  computeStatsMvp,
} from "@/lib/services/match/stats.service";

export const POST = safeRoute(
  async (req: NextRequest) => {
    // 1. Autenticação e restrição máxima (Apenas SUPER_ADMIN)
    const session = await requireAuth();
    requireRole(Role.SUPER_ADMIN);

    // 2. Extração e validação do Body e IP
    const body = await req.json();
    const input = validatePayload(adminRecalculateSchema, body);
    const ip = await getClientIp();

    const actor = {
      userId: session.userId,
      role: session.role,
      ip,
    };

    // 3. Roteamento da ação baseado no escopo (XOR garantido pelo Zod)

    // CASO A: Recálculo em lote para um Split inteiro
    if (input.splitId) {
      const result = await recalculateSplitStandings(input.splitId, actor);

      return NextResponse.json(
        {
          success: true,
          data: {
            message: "Classificação do split recalculada com sucesso.",
            ...result,
          },
        },
        { status: 201 },
      );
    }

    // CASO B: Recálculo específico para uma Partida
    if (input.matchId) {
      await db.$transaction(async (tx) => {
        // Busca a partida para montar o contexto exigido pelo updateStandings
        const matchContext = await tx.match.findUnique({
          where: { id: input.matchId! },
        });

        if (!matchContext) {
          throw new Error("Partida não encontrada para recálculo.");
        }

        // Re-executa as 3 funções vitais de finalização de partida
        await recalculateMatchStats(input.matchId!, actor.userId, ip, tx);

        // Passamos o contexto da partida. O "as any" garante que o TypeScript
        // aceite caso o seu tipo local exija campos populados (como includes).
        await updateStandings(matchContext as any, actor.userId, ip, tx);

        await computeStatsMvp(input.matchId!, actor.userId, ip, tx);

        // AuditLog atômico dentro da mesma transação
        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: "STATS_RECALCULATE",
            entity: "Match",
            entityId: input.matchId!,
            ip,
            metadata: { scope: "match", reason: input.reason },
          },
        });
      });

      return NextResponse.json(
        {
          success: true,
          data: {
            message: "Estatísticas da partida recalculadas com sucesso.",
          },
        },
        { status: 201 },
      );
    }

    // Fallback de segurança (o Zod deve bloquear a chegada aqui sem matchId ou splitId)
    return NextResponse.json(
      { success: false, error: "Escopo de recálculo inválido." },
      { status: 400 },
    );
  },
  { rateLimitBucket: "adminWrite" },
);
