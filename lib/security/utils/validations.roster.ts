/**
 * ============================================================================
 * HEZI TECH — VALIDAÇÕES DE ROSTER (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/security/utils/validations.roster.ts
 * Camada de Defesa: C4 (Anti-Mass-Assignment)
 *
 * PROPÓSITO:
 * Garantir que os payloads de entrada respeitem estritamente os tipos e
 * tamanhos esperados antes de atingir a camada de serviço. O uso de `.strict()`
 * bloqueia campos não declarados, mitigando ataques de Mass Assignment.
 *
 * CONVENÇÕES (alinhadas com validations.league.ts):
 *   1. Slugs: regex ^[a-z0-9]+(?:-[a-z0-9]+)*$ (sem hífens no início/fim).
 *   2. Campos @db.Text: max 2000 chars (defesa antecipada ao sanitize de 100KB).
 *   3. Updates parciais: .partial().strict() + refinement "pelo menos 1 campo".
 *   4. IDs de FK: sempre validados como .uuid().
 *   5. exactOptionalPropertyTypes: campos omitíveis usam .optional().
 * ============================================================================
 */

import { z } from "zod";
import { Position, PlayerStatus, SocialPlatform } from "@prisma/client";

// ============================================================================
// HELPERS COMPARTILHADOS (alinhados com validations.league.ts)
// ============================================================================

/**
 * Slug para URL amigável: minúsculas, números, hífen interno.
 * Proíbe: espaços, caracteres especiais, underscores, acentos,
 * hífens no início/fim, hífens consecutivos.
 */
const slugField = z
  .string()
  .trim()
  .min(3, "O slug deve ter pelo menos 3 caracteres.")
  .max(80, "O slug não pode exceder 80 caracteres.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug deve conter apenas letras minúsculas, números e hífens (ex: 'guild-warriors').",
  );

/** Cor hexadecimal #RRGGBB. */
const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

/** URL com validação HTTP(S) — bloqueia javascript: e schemes maliciosos. */
const httpUrlField = z
  .string()
  .url("URL inválida.")
  .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
    message: "A URL deve começar com http:// ou https://.",
  });

// ============================================================================
// TEAM SCHEMAS
// ============================================================================

export const createTeamSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "O nome do time deve ter pelo menos 3 caracteres.")
      .max(100, "O nome do time não pode exceder 100 caracteres."),
    slug: slugField,
    shortName: z
      .string()
      .length(3, "A sigla do time deve ter exatamente 3 caracteres.")
      .toUpperCase()
      .optional(),
    logoUrl: httpUrlField.optional(),
    bannerUrl: httpUrlField.optional(),
    primaryColor: z
      .string()
      .regex(hexColorRegex, "Cor primária inválida (deve ser #RRGGBB).")
      .optional(),
    secondaryColor: z
      .string()
      .regex(hexColorRegex, "Cor secundária inválida (deve ser #RRGGBB).")
      .optional(),
    presidentName: z.string().trim().max(100).optional(),
    presidentPhotoUrl: httpUrlField.optional(),
    description: z
      .string()
      .max(2000, "A descrição não pode exceder 2000 caracteres.")
      .optional(),
    foundedYear: z
      .number()
      .int()
      .min(1900, "Ano mínimo é 1900.")
      .max(new Date().getFullYear(), "Ano não pode ser no futuro.")
      .optional(),
    homeVenueId: z.string().uuid("ID de local inválido.").optional(),
  })
  .strict();

export const updateTeamSchema = createTeamSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

// ============================================================================
// PLAYER SCHEMAS
// ============================================================================

export const createPlayerSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, "O nome deve ter pelo menos 2 caracteres.")
      .max(50, "O nome não pode exceder 50 caracteres."),
    lastName: z
      .string()
      .trim()
      .min(2, "O sobrenome deve ter pelo menos 2 caracteres.")
      .max(50, "O sobrenome não pode exceder 50 caracteres."),
    nickname: z.string().trim().max(50).optional(),
    slug: slugField,
    photoUrl: httpUrlField.optional(),
    nationality: z.string().trim().max(50).default("Brasileiro"),
    dateOfBirth: z.string().datetime("Data de nascimento inválida.").optional(),
    position: z.nativeEnum(Position),
    heightCm: z.number().int().min(100).max(250).optional(),
    weightKg: z.number().int().min(40).max(200).optional(),
    bio: z
      .string()
      .max(2000, "A bio não pode exceder 2000 caracteres.")
      .optional(),
    userId: z.string().uuid("Vínculo de usuário inválido.").optional(),
  })
  .strict();

export const updatePlayerSchema = createPlayerSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

export const updatePlayerStatusSchema = z
  .object({
    status: z.nativeEnum(PlayerStatus),
    reason: z
      .string()
      .trim()
      .min(5, "O motivo deve ter pelo menos 5 caracteres.")
      .max(500, "O motivo não pode exceder 500 caracteres."),
  })
  .strict();

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type UpdatePlayerStatusInput = z.infer<typeof updatePlayerStatusSchema>;

// ============================================================================
// CONTRACT SCHEMAS (Union discriminação por flag + Escopo por Split)
// ============================================================================

const contractBase = {
  jerseyNumber: z
    .number()
    .int()
    .min(0, "Número da camisa mínimo é 0.")
    .max(99, "Número da camisa máximo é 99."),
  startDate: z.string().datetime("Data de início inválida."),
  splitId: z.string().uuid("splitId inválido."),
};

export const contractActionSchema = z.union([
  z
    .object({
      isInitial: z.literal(true),
      teamId: z.string().uuid("teamId inválido."),
      ...contractBase,
    })
    .strict(),

  z
    .object({
      isTransfer: z.literal(true),
      newTeamId: z.string().uuid("newTeamId inválido."),
      transferFee: z
        .number()
        .positive("Taxa de transferência deve ser positiva.")
        .optional(),
      ...contractBase,
    })
    .strict(),
]);

export type ContractActionInput = z.infer<typeof contractActionSchema>;

const contractReasonValues = ["RETIRED", "RELEASED", "INJURED_LONG"] as const;

export const closeContractSchema = z
  .object({
    reason: z.enum(contractReasonValues, {
      error: "Motivo deve ser RETIRED, RELEASED ou INJURED_LONG.",
    }),
  })
  .strict();

export type CloseContractInput = z.infer<typeof closeContractSchema>;

// ============================================================================
// SOCIAL LINKS SCHEMAS
// ============================================================================

export const upsertSocialLinkSchema = z
  .object({
    platform: z.nativeEnum(SocialPlatform),
    url: httpUrlField,
  })
  .strict();

export const removeSocialLinkSchema = z
  .object({
    platform: z.nativeEnum(SocialPlatform),
  })
  .strict();

export type UpsertSocialLinkInput = z.infer<typeof upsertSocialLinkSchema>;
export type RemoveSocialLinkInput = z.infer<typeof removeSocialLinkSchema>;
