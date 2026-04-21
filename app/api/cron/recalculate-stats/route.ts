import { NextRequest, NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { cronRecalculateSchema } from "@/lib/security/utils/validations.stats";
import { validatePayload } from "@/lib/security/utils/validate";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { db } from "@/lib/db";
import { recalculateSplitStandings } from "@/lib/services/match/stats.service";
import { UnauthorizedError } from "@/lib/security/utils/errors";

export const POST = safeRoute(
  async (req: NextRequest) => {
    // 1. Segurança Especial: Validação do Bearer Token
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      // Falha rápida e silenciosa (401 genérico) para não vazar que é uma rota de cron
      throw new UnauthorizedError("Acesso não autorizado.");
    }

    // 2. Extração segura do Body (Cron jobs podem enviar body vazio)
    let rawBody = {};
    try {
      rawBody = await req.json();
    } catch (e) {
      // Ignora erro de JSON vazio
    }

    // Validação Zod com o schema que criamos no Passo 1
    const input = validatePayload(cronRecalculateSchema, rawBody);
    const ip = await getClientIp();

    const systemActor = { userId: "SYSTEM", ip };

    // 3. Roteamento de execução baseado no escopo solicitado
    if (input.scope === "split" && input.id) {
      // Recalcula todas as estatísticas e tabela de um split específico
      await recalculateSplitStandings(input.id, systemActor);
    } else if (input.scope === "season" && input.id) {
      // Placeholder: Agregação massiva de Season (PlayerSeasonStat)
      // Conforme E3.4, este job pesado será finalizado nas próximas fases.
      await db.auditLog.create({
        data: {
          userId: systemActor.userId,
          action: "STATS_RECALCULATE",
          entity: "Season",
          entityId: input.id,
          ip,
          metadata: { scope: "season", status: "placeholder_executed" },
        },
      });
    } else {
      // Escopo Global (se nenhum escopo específico for enviado)
      await db.auditLog.create({
        data: {
          userId: systemActor.userId,
          action: "STATS_RECALCULATE",
          entity: "System",
          entityId: "global-cron",
          ip,
          metadata: { scope: "global", status: "placeholder_executed" },
        },
      });
    }

    // 4. Retorno HTTP
    return NextResponse.json(
      {
        success: true,
        data: { message: "Cron job finalizado com sucesso." },
      },
      { status: 201 },
    );
  },
  {
    checkCsrf: false, // Fundamental para Server-to-Server
    // O rateLimitBucket é opcional aqui caso o safeRoute aceite undefined.
    // Caso exija, use "audit" (10/min) para evitar spam se a chave vazar.
    rateLimitBucket: "audit",
  },
);
