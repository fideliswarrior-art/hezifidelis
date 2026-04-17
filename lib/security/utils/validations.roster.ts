/**
 * ============================================================================
 * HEZI TECH — VALIDAÇÕES DE ROSTER (Onda 3 - E3.2)
 * ============================================================================
 * Arquivo: lib/security/utils/validations.roster.ts
 * ============================================================================
 */

import { z } from "zod";
import { Position, PlayerStatus, SocialPlatform } from "@prisma/client";

const slugRegex = /^[a-z0-9-]+$/;
const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

// ============================================================================
// TEAM SCHEMAS
// ============================================================================

export const createTeamSchema = z
  .object({
    name: z.string().min(3).max(100),
    slug: z
      .string()
      .regex(
        slugRegex,
        "Slug deve conter apenas letras minúsculas, números e hifens",
      ),
    shortName: z.string().length(3).optional(),
    logoUrl: z.string().url().optional(),
    bannerUrl: z.string().url().optional(),
    primaryColor: z
      .string()
      .regex(hexColorRegex, "Cor primária inválida (deve ser Hex)")
      .optional(),
    secondaryColor: z
      .string()
      .regex(hexColorRegex, "Cor secundária inválida (deve ser Hex)")
      .optional(),
    presidentName: z.string().optional(),
    presidentPhotoUrl: z.string().url().optional(),
    description: z.string().max(2000).optional(),
    foundedYear: z.number().min(1900).max(new Date().getFullYear()).optional(),
    homeVenueId: z.string().optional(),
  })
  .strict();

export const updateTeamSchema = createTeamSchema.partial().strict();

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

// ============================================================================
// PLAYER SCHEMAS
// ============================================================================

export const createPlayerSchema = z
  .object({
    firstName: z.string().min(2).max(50),
    lastName: z.string().min(2).max(50),
    nickname: z.string().max(50).optional(),
    slug: z
      .string()
      .regex(slugRegex, "Slug deve conter apenas minúsculas, números e hifens"),
    photoUrl: z.string().url().optional(),
    nationality: z.string().default("Brasileiro"),
    dateOfBirth: z.string().datetime().optional(), // Recebido como ISO 8601
    position: z.nativeEnum(Position),
    heightCm: z.number().int().min(100).max(250).optional(),
    weightKg: z.number().int().min(40).max(200).optional(),
    bio: z.string().max(2000).optional(),
    userId: z.string().optional(), // Vínculo 1:1 opcional criado na E3.2
  })
  .strict();

export const updatePlayerSchema = createPlayerSchema.partial().strict();

export const updatePlayerStatusSchema = z
  .object({
    status: z.nativeEnum(PlayerStatus),
    reason: z.string().min(5).max(500),
  })
  .strict();

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type UpdatePlayerStatusInput = z.infer<typeof updatePlayerStatusSchema>;

// ============================================================================
// CONTRACT SCHEMAS (Union discriminação por flag)
// ============================================================================

const contractBase = {
  jerseyNumber: z.number().int().min(0).max(99),
  startDate: z.string().datetime(), // Data de início do contrato
};

export const contractActionSchema = z.union([
  z
    .object({
      isInitial: z.literal(true),
      teamId: z.string(),
      ...contractBase,
    })
    .strict(),
  z
    .object({
      isTransfer: z.literal(true),
      newTeamId: z.string(),
      transferFee: z.number().positive().optional(),
      ...contractBase,
    })
    .strict(),
]);

export type ContractActionInput = z.infer<typeof contractActionSchema>;

// ============================================================================
// SOCIAL LINKS SCHEMAS
// ============================================================================

export const upsertSocialLinkSchema = z
  .object({
    platform: z.nativeEnum(SocialPlatform),
    url: z.string().url("A URL da rede social é inválida"),
  })
  .strict();

export const removeSocialLinkSchema = z
  .object({
    platform: z.nativeEnum(SocialPlatform),
  })
  .strict();

export type UpsertSocialLinkInput = z.infer<typeof upsertSocialLinkSchema>;
export type RemoveSocialLinkInput = z.infer<typeof removeSocialLinkSchema>;
