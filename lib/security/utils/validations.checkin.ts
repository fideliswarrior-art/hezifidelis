import { z } from "zod";
import { CheckInMethod } from "@prisma/client";

// ─── Regex do QR permanente do jogador ───────────────────────
const PLAYER_QR_REGEX =
  /^HEZI-PLAYER-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─── Scan (operador escaneia QR do jogador) ──────────────────
export const scanCheckInSchema = z
  .object({
    qrCode: z.string().regex(PLAYER_QR_REGEX, "Formato de QR inválido."),
    matchId: z.string().uuid("matchId inválido.").optional(),
    splitId: z.string().uuid("splitId inválido.").optional(),
    notes: z
      .string()
      .trim()
      .max(500, "Notas devem ter no máximo 500 caracteres.")
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasMatch = !!data.matchId;
    const hasSplit = !!data.splitId;

    if (!hasMatch && !hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe matchId ou splitId.",
        path: ["matchId"],
      });
    }

    if (hasMatch && hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe apenas matchId ou splitId, não ambos.",
        path: ["splitId"],
      });
    }
  });

// ─── Check-in manual (admin sem scan) ────────────────────────
export const manualCheckInSchema = z
  .object({
    playerId: z.string().uuid("playerId inválido."),
    matchId: z.string().uuid("matchId inválido.").optional(),
    splitId: z.string().uuid("splitId inválido.").optional(),
    notes: z
      .string()
      .trim()
      .max(500, "Notas devem ter no máximo 500 caracteres.")
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasMatch = !!data.matchId;
    const hasSplit = !!data.splitId;

    if (!hasMatch && !hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe matchId ou splitId.",
        path: ["matchId"],
      });
    }

    if (hasMatch && hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe apenas matchId ou splitId, não ambos.",
        path: ["splitId"],
      });
    }
  });

// ─── Listagem de check-ins (query params) ────────────────────
export const listCheckInsQuerySchema = z
  .object({
    matchId: z.string().uuid("matchId inválido.").optional(),
    splitId: z.string().uuid("splitId inválido.").optional(),
  })
  .strict()
  .refine((data) => !!data.matchId || !!data.splitId, {
    message: "Informe matchId ou splitId.",
    path: ["matchId"],
  });

// ─── Tipos inferidos (para consumo nos services/rotas) ───────
export type ScanCheckInInput = z.infer<typeof scanCheckInSchema>;
export type ManualCheckInInput = z.infer<typeof manualCheckInSchema>;
export type ListCheckInsQuery = z.infer<typeof listCheckInsQuerySchema>;
