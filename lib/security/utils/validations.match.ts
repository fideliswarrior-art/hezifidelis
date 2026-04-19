/**
 * ============================================================================
 * HEZI TECH — VALIDAÇÕES DE PARTIDAS E SCOREBOOK (Onda 3 - E3.3)
 * ============================================================================
 * Arquivo: lib/security/utils/validations.match.ts
 * Camada de Defesa: C4 (Anti-Mass-Assignment) + C5 (Integridade de Jogo)
 *
 * REGRAS INEGOCIÁVEIS:
 *   1. homeScore, awayScore, homeTeamFouls, awayTeamFouls NUNCA aparecem
 *      em nenhum schema de input. São sempre calculados server-side.
 *   2. Eventos de pontuação (TWO_POINT_MADE, etc.) DEVEM ter teamSide
 *      e playerId. Eventos de controle (PERIOD_START, etc.) NÃO.
 *   3. `value` em eventos de pontuação é derivado pelo service a partir
 *      do type — nunca aceito do client.
 *   4. voidReason exige mínimo 10 caracteres (previne anulações sem
 *      justificativa adequada).
 *   5. homeTeamId !== awayTeamId validado via superRefine.
 * ============================================================================
 */

import { z } from "zod";
import {
  GameFormat,
  MatchStatus,
  MatchEventType,
  TeamSide,
  OfficialRole,
} from "@prisma/client";

// ============================================================================
// HELPERS
// ============================================================================

const httpUrlField = z
  .string()
  .url("URL inválida.")
  .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
    message: "A URL deve começar com http:// ou https://.",
  });

const paginationQuery = {
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid("Cursor inválido.").optional(),
};

// ============================================================================
// TIPOS DE EVENTO — Conjuntos para validação contextual
// ============================================================================

/** Eventos que marcam pontuação — exigem teamSide + playerId obrigatórios. */
export const SCORING_EVENTS = new Set<MatchEventType>([
  MatchEventType.TWO_POINT_MADE,
  MatchEventType.THREE_POINT_MADE,
  MatchEventType.FREE_THROW_MADE,
]);

/** Eventos de arremesso errado — exigem teamSide + playerId. */
export const MISSED_SHOT_EVENTS = new Set<MatchEventType>([
  MatchEventType.TWO_POINT_MISSED,
  MatchEventType.THREE_POINT_MISSED,
  MatchEventType.FREE_THROW_MISSED,
]);

/** Eventos individuais de jogador — exigem teamSide + playerId. */
export const PLAYER_EVENTS = new Set<MatchEventType>([
  MatchEventType.TWO_POINT_MADE,
  MatchEventType.TWO_POINT_MISSED,
  MatchEventType.THREE_POINT_MADE,
  MatchEventType.THREE_POINT_MISSED,
  MatchEventType.FREE_THROW_MADE,
  MatchEventType.FREE_THROW_MISSED,
  MatchEventType.REBOUND_OFFENSIVE,
  MatchEventType.REBOUND_DEFENSIVE,
  MatchEventType.STEAL,
  MatchEventType.BLOCK,
  MatchEventType.TURNOVER,
  MatchEventType.PERSONAL_FOUL,
  MatchEventType.TECHNICAL_FOUL,
  MatchEventType.FLAGRANT_FOUL,
  MatchEventType.SUBSTITUTION_IN,
  MatchEventType.SUBSTITUTION_OUT,
]);

/** Eventos de time (sem jogador específico) — exigem teamSide, playerId null. */
export const TEAM_EVENTS = new Set<MatchEventType>([
  MatchEventType.TIMEOUT_CALLED,
]);

/** Eventos de controle de jogo — teamSide e playerId são null. */
export const CONTROL_EVENTS = new Set<MatchEventType>([
  MatchEventType.PERIOD_START,
  MatchEventType.PERIOD_END,
  MatchEventType.OVERTIME_START,
  MatchEventType.GAME_START,
  MatchEventType.GAME_END,
]);

// ============================================================================
// MATCH SCHEMAS
// ============================================================================

export const createMatchSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "O título deve ter pelo menos 3 caracteres.")
      .max(200, "O título não pode exceder 200 caracteres.")
      .optional(),
    scheduledFor: z.coerce.date({
      message: "Data de agendamento inválida ou ausente.",
    }),
    format: z.nativeEnum(GameFormat),
    isOfficial: z.boolean().default(true),

    // Posição na estrutura da liga (ao menos um obrigatório)
    phaseId: z.string().uuid("phaseId inválido.").optional(),
    groupId: z.string().uuid("groupId inválido.").optional(),
    seriesId: z.string().uuid("seriesId inválido.").optional(),
    gameNumberInSeries: z.number().int().min(1).max(9).optional(),

    venueId: z.string().uuid("venueId inválido.").optional(),

    homeTeamId: z.string().uuid("homeTeamId inválido."),
    awayTeamId: z.string().uuid("awayTeamId inválido."),

    streamUrl: httpUrlField.optional(),
    streamUrlBk: httpUrlField.optional(),
    durationMinutes: z.number().int().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Times distintos
    if (data.homeTeamId === data.awayTeamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["awayTeamId"],
        message: "O time visitante deve ser diferente do mandante.",
      });
    }

    // Ao menos um contexto de liga
    if (!data.phaseId && !data.groupId && !data.seriesId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phaseId"],
        message:
          "A partida deve estar vinculada a uma Phase, Group ou PlayoffSeries.",
      });
    }

    // gameNumberInSeries só faz sentido com seriesId
    if (data.gameNumberInSeries && !data.seriesId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameNumberInSeries"],
        message: "gameNumberInSeries requer seriesId.",
      });
    }
  });

export type CreateMatchInput = z.infer<typeof createMatchSchema>;

// ============================================================================
// OFFICIAL SCHEMAS
// ============================================================================

export const assignOfficialSchema = z
  .object({
    userId: z.string().uuid("userId inválido."),
    role: z.nativeEnum(OfficialRole),
  })
  .strict();

export const removeOfficialSchema = z
  .object({
    userId: z.string().uuid("userId inválido."),
    role: z.nativeEnum(OfficialRole),
  })
  .strict();

export type AssignOfficialInput = z.infer<typeof assignOfficialSchema>;
export type RemoveOfficialInput = z.infer<typeof removeOfficialSchema>;

// ============================================================================
// MATCH EVENT SCHEMAS
// ============================================================================

/**
 * Schema de registro de evento (lance ao vivo).
 *
 * A validação contextual (teamSide/playerId obrigatórios para eventos de
 * jogador, proibidos para eventos de controle) é feita via superRefine.
 *
 * O campo `value` (pontos) NÃO é aceito do client — é derivado pelo
 * service a partir do type (TWO_POINT_MADE=2, THREE_POINT_MADE=3, etc.).
 */
export const registerEventSchema = z
  .object({
    type: z.nativeEnum(MatchEventType),
    teamSide: z.nativeEnum(TeamSide).optional(),
    playerId: z.string().uuid("playerId inválido.").optional(),
    period: z
      .number()
      .int()
      .min(1, "O período deve ser maior ou igual a 1.")
      .max(10, "Período máximo é 10 (OT).")
      .optional(),
    gameClockMs: z
      .number()
      .int()
      .min(0, "O relógio não pode ser negativo.")
      .optional(),
    note: z
      .string()
      .trim()
      .max(500, "A observação não pode exceder 500 caracteres.")
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const type = data.type;

    // Eventos de jogador: exigem teamSide + playerId
    if (PLAYER_EVENTS.has(type)) {
      if (!data.teamSide) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["teamSide"],
          message: `Eventos do tipo ${type} exigem teamSide (HOME ou AWAY).`,
        });
      }
      if (!data.playerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["playerId"],
          message: `Eventos do tipo ${type} exigem playerId.`,
        });
      }
    }

    // Eventos de time: exigem teamSide, proíbem playerId
    if (TEAM_EVENTS.has(type)) {
      if (!data.teamSide) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["teamSide"],
          message: `Eventos do tipo ${type} exigem teamSide.`,
        });
      }
      if (data.playerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["playerId"],
          message: `Eventos do tipo ${type} não devem ter playerId.`,
        });
      }
    }

    // Eventos de controle: proíbem ambos
    if (CONTROL_EVENTS.has(type)) {
      if (data.teamSide) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["teamSide"],
          message: `Eventos de controle (${type}) não devem ter teamSide.`,
        });
      }
      if (data.playerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["playerId"],
          message: `Eventos de controle (${type}) não devem ter playerId.`,
        });
      }
    }

    // Período obrigatório para eventos que não são de controle de jogo
    // (GAME_START/GAME_END não têm período; PERIOD_START usa o período informado)
    const noRequirePeriod = new Set<MatchEventType>([
      MatchEventType.GAME_START,
      MatchEventType.GAME_END,
    ]);
    if (!noRequirePeriod.has(type) && data.period === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period"],
        message: `O período é obrigatório para eventos do tipo ${type}.`,
      });
    }
  });

export type RegisterEventInput = z.infer<typeof registerEventSchema>;

/**
 * Schema para anulação de evento.
 * voidReason mínimo 10 chars — previne anulações sem justificativa.
 */
export const voidEventSchema = z
  .object({
    voidReason: z
      .string()
      .trim()
      .min(10, "O motivo da anulação deve ter pelo menos 10 caracteres.")
      .max(500, "O motivo não pode exceder 500 caracteres."),
  })
  .strict();

export type VoidEventInput = z.infer<typeof voidEventSchema>;

// ============================================================================
// LIST / QUERY SCHEMAS
// ============================================================================

export const listMatchesQuerySchema = z.object({
  status: z.nativeEnum(MatchStatus).optional(),
  homeTeamId: z.string().uuid().optional(),
  awayTeamId: z.string().uuid().optional(),
  phaseId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  seriesId: z.string().uuid().optional(),
  isOfficial: z.coerce.boolean().optional(),
  format: z.nativeEnum(GameFormat).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationQuery,
});

export type ListMatchesQuery = z.infer<typeof listMatchesQuerySchema>;
