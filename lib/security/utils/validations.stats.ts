import { z } from "zod";
import { sanitizePlainText } from "@/lib/security/content/sanitize";

export const mvpOverrideSchema = z
  .object({
    playerId: z.string().uuid("ID de jogador inválido."),
    reason: z
      .string()
      .trim()
      .min(10, "Justificativa deve ter ao menos 10 caracteres.")
      .max(500, "Justificativa não pode exceder 500 caracteres.")
      .transform((val) => sanitizePlainText(val, 500)),
  })
  .strict();

export const standingsQuerySchema = z
  .object({
    splitId: z.string().uuid("ID de split inválido.").optional(),
    groupId: z.string().uuid("ID de grupo inválido.").optional(),
  })
  .strict()
  .refine((data) => data.splitId || data.groupId, {
    message: "É necessário fornecer ao menos um filtro: splitId ou groupId.",
    path: ["splitId"],
  });

export const playerStatsQuerySchema = z
  .object({
    splitId: z.string().uuid("ID de split inválido.").optional(),
    seasonId: z.string().uuid("ID de temporada inválido.").optional(),
  })
  .strict();

export const cronRecalculateSchema = z
  .object({
    scope: z.enum(["season", "split"]).optional(),
    id: z.string().uuid("ID inválido.").optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.scope && !data.id) return false;
      return true;
    },
    {
      message: "Se o escopo for presente, o id é obrigatório.",
      path: ["id"],
    },
  );

export const adminRecalculateSchema = z
  .object({
    matchId: z.string().uuid("ID de partida inválido.").optional(),
    splitId: z.string().uuid("ID de split inválido.").optional(),
    reason: z
      .string()
      .trim()
      .min(10, "A justificativa deve ter ao menos 10 caracteres.")
      .max(500, "A justificativa não pode exceder 500 caracteres.")
      .transform((val) => sanitizePlainText(val, 500)),
  })
  .strict()
  .refine(
    (data) =>
      (data.matchId && !data.splitId) || (!data.matchId && data.splitId),
    {
      message:
        "Forneça exatamente um escopo para recálculo: matchId OU splitId (não ambos).",
      path: ["matchId"],
    },
  );
