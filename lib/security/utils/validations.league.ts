import { z } from "zod";
import { SplitType, PhaseType, GameFormat } from "@prisma/client";

/**
 * ============================================================================
 * HEZI TECH — VALIDAÇÕES DA ESTRUTURA DA LIGA (Onda 3 - E3.1)
 * ============================================================================
 * Arquivo: lib/security/utils/validations.league.ts
 * Camada de Defesa: C3 (Controle de Acesso) + C6 (Workflow/Status)
 *
 * PROPÓSITO:
 * Centralizar todos os schemas Zod para os serviços de Liga:
 *   - Season  (Temporada/Torneio)
 *   - Split   (Etapa/Sub-competição)
 *   - Phase   (Fase dentro do split)
 *   - Group   (Grupo dentro da fase)
 *
 * REGRAS INEGOCIÁVEIS:
 *  1. O campo `isActive` NUNCA aparece em create/update schemas.
 *     Ativação/desativação é exclusiva dos endpoints dedicados
 *     `/activate` e `/deactivate`.
 *     Isso bloqueia ataques de mass-assignment.
 *
 *  2. **DESIGN DE MÚLTIPLOS TORNEIOS SIMULTÂNEOS:**
 *     Diferente da versão original, NÃO aplicamos exclusividade de
 *     `isActive`. Múltiplas Seasons e múltiplos Splits podem coexistir
 *     com `isActive = true`, pois a plataforma comunitária precisa rodar
 *     vários torneios em paralelo (ex: Copa de Abril + Copa de Julho).
 *
 *  3. Todos os `@db.Text` (description, notes) passam por validação
 *     de TAMANHO aqui. A SANITIZAÇÃO contra XSS é feita no service
 *     via sanitizeHtml/sanitizePlainText (E2.2 - Onda 2).
 *
 *  4. Datas são aceitas como string ISO 8601 e convertidas para Date
 *     via z.coerce.date().
 *
 *  5. Campos FK (seasonId, splitId, phaseId) são validados como UUID.
 *
 *  6. exactOptionalPropertyTypes: true:
 *     - Campos que podem ser omitidos → .optional()
 *     - Campos que podem ser null no banco (Prisma) → .nullable().optional()
 *
 *  7. Todos os tipos inferidos são exportados como `<Nome>Input`.
 * ============================================================================
 */

// ============================================================================
// HELPERS COMPARTILHADOS
// ============================================================================

/** Nome curto, reutilizado em Season/Split/Phase. */
const nameField = z
  .string()
  .trim()
  .min(3, "O nome deve ter pelo menos 3 caracteres.")
  .max(100, "O nome não pode exceder 100 caracteres.");

/** Nome de grupo (pode ser bem curto — "A", "B", "Norte"). */
const groupNameField = z
  .string()
  .trim()
  .min(1, "O nome do grupo é obrigatório.")
  .max(50, "O nome do grupo não pode exceder 50 caracteres.");

/**
 * Slug para URL amigável: minúsculas, números, hífen.
 * Exemplos válidos: "copa-abril-2026", "liga-feminina-vi", "3x3-verao-26"
 * Proíbe: espaços, caracteres especiais, underscores, acentos, hífen no início/fim.
 */
const slugField = z
  .string()
  .trim()
  .min(3, "O slug deve ter pelo menos 3 caracteres.")
  .max(80, "O slug não pode exceder 80 caracteres.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug deve conter apenas letras minúsculas, números e hífens (ex: 'copa-abril-2026').",
  );

/**
 * Código curto alfanumérico em MAIÚSCULAS: 3-8 caracteres.
 * Exemplos: "CAB26", "LF2026", "3X3VER"
 * Uso: badges, notificações push, filtros rápidos, tabelas compactas.
 */
const shortCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "O código curto deve ter pelo menos 3 caracteres.")
  .max(8, "O código curto não pode exceder 8 caracteres.")
  .regex(
    /^[A-Z0-9]+$/,
    "Código curto deve conter apenas letras maiúsculas e números (ex: 'CAB26').",
  );

/**
 * Descrição em @db.Text — limitamos a 2000 chars no input.
 * O sanitizeHtml (E2.2) tem trava dura de 100KB; 2000 é defesa antecipada.
 */
const descriptionField = z
  .string()
  .max(2000, "A descrição não pode exceder 2000 caracteres.");

/** URL com validação HTTP(S) — evita `javascript:` e schemes maliciosos. */
const httpUrlField = z
  .string()
  .url("URL inválida.")
  .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
    message: "A URL deve começar com http:// ou https://.",
  });

/** Paginação por cursor (Onda 2 - E2.4 estabeleceu o padrão). */
const paginationQuery = {
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid("Cursor inválido.").optional(),
};

/** Refinamento transversal: endDate >= startDate quando ambas presentes. */
const dateRangeRefinement = <
  T extends {
    startDate?: Date | null | undefined;
    endDate?: Date | null | undefined;
  },
>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message:
        "A data de término deve ser igual ou posterior à data de início.",
    });
  }
};

// ============================================================================
// SEASON (Temporada / Torneio)
// ============================================================================

/**
 * Criação de Season (Torneio).
 *
 * Regras de negócio (aplicadas NO SERVICE):
 *   - A season NUNCA nasce com isActive = true.
 *   - slug e shortCode devem ser únicos globalmente (validado pelo banco via @unique).
 */
export const createSeasonSchema = z
  .object({
    name: nameField,
    slug: slugField,
    shortCode: shortCodeField,
    year: z
      .number()
      .int()
      .min(2020, "Ano mínimo é 2020.")
      .max(2100, "Ano máximo é 2100."),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),
    description: descriptionField.nullable().optional(),
  })
  .strict()
  .superRefine(dateRangeRefinement);

/**
 * Atualização de Season.
 *
 * Regras:
 *   - TODOS os campos são opcionais (patch parcial).
 *   - `isActive` BLOQUEADO — vai para /activate.
 *   - `slug` PODE ser alterado, mas quebra URLs antigas.
 *     O service alerta no AuditLog quando isso ocorrer.
 */
export const updateSeasonSchema = z
  .object({
    name: nameField.optional(),
    slug: slugField.optional(),
    shortCode: shortCodeField.optional(),
    year: z.number().int().min(2020).max(2100).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
    description: descriptionField.nullable().optional(),
  })
  .strict()
  .superRefine(dateRangeRefinement)
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

/** Query de listagem pública de Seasons. */
export const listSeasonsQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  isActive: z.coerce.boolean().optional(),
  slug: slugField.optional(),
  ...paginationQuery,
});

export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;
export type ListSeasonsQuery = z.infer<typeof listSeasonsQuerySchema>;

// ============================================================================
// SPLIT (Etapa / Sub-competição)
// ============================================================================

export const createSplitSchema = z
  .object({
    name: nameField,
    type: z.nativeEnum(SplitType),
    defaultFormat: z.nativeEnum(GameFormat).default(GameFormat.FIVE_ON_FIVE),
    seasonId: z.string().uuid("seasonId inválido."),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),
    description: descriptionField.nullable().optional(),
    rulesUrl: httpUrlField.nullable().optional(),
  })
  .strict()
  .superRefine(dateRangeRefinement);

export const updateSplitSchema = z
  .object({
    name: nameField.optional(),
    type: z.nativeEnum(SplitType).optional(),
    defaultFormat: z.nativeEnum(GameFormat).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
    description: descriptionField.nullable().optional(),
    rulesUrl: httpUrlField.nullable().optional(),
  })
  .strict()
  .superRefine(dateRangeRefinement)
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

export const listSplitsQuerySchema = z.object({
  seasonId: z.string().uuid().optional(),
  type: z.nativeEnum(SplitType).optional(),
  isActive: z.coerce.boolean().optional(),
  ...paginationQuery,
});

export type CreateSplitInput = z.infer<typeof createSplitSchema>;
export type UpdateSplitInput = z.infer<typeof updateSplitSchema>;
export type ListSplitsQuery = z.infer<typeof listSplitsQuerySchema>;

// ============================================================================
// PHASE (Fase dentro do Split)
// ============================================================================

export const createPhaseSchema = z
  .object({
    name: nameField,
    type: z.nativeEnum(PhaseType),
    splitId: z.string().uuid("splitId inválido."),
    order: z
      .number()
      .int()
      .min(1, "A ordem deve ser maior ou igual a 1.")
      .max(20, "Ordem máxima de 20 fases por split."),
  })
  .strict();

export const updatePhaseSchema = z
  .object({
    name: nameField.optional(),
    type: z.nativeEnum(PhaseType).optional(),
    order: z.number().int().min(1).max(20).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

export const reorderPhasesSchema = z
  .object({
    splitId: z.string().uuid("splitId inválido."),
    phaseIds: z
      .array(z.string().uuid("phaseId inválido."))
      .min(2, "Reordenação exige ao menos 2 fases.")
      .max(20, "Máximo de 20 fases suportadas.")
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "phaseIds não pode conter duplicatas.",
      }),
  })
  .strict();

export const listPhasesQuerySchema = z.object({
  splitId: z.string().uuid().optional(),
  type: z.nativeEnum(PhaseType).optional(),
  ...paginationQuery,
});

export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;
export type ReorderPhasesInput = z.infer<typeof reorderPhasesSchema>;
export type ListPhasesQuery = z.infer<typeof listPhasesQuerySchema>;

// ============================================================================
// GROUP (Grupo dentro da Phase)
// ============================================================================

export const createGroupSchema = z
  .object({
    name: groupNameField,
    phaseId: z.string().uuid("phaseId inválido."),
  })
  .strict();

export const updateGroupSchema = z
  .object({
    name: groupNameField.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser enviado para atualização.",
  });

export const listGroupsQuerySchema = z.object({
  phaseId: z.string().uuid().optional(),
  ...paginationQuery,
});

export const assignTeamToGroupSchema = z
  .object({
    teamId: z.string().uuid("teamId inválido."),
    groupId: z.string().uuid("groupId inválido."),
  })
  .strict();

export const removeTeamFromGroupSchema = assignTeamToGroupSchema;

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;
export type AssignTeamToGroupInput = z.infer<typeof assignTeamToGroupSchema>;
export type RemoveTeamFromGroupInput = z.infer<
  typeof removeTeamFromGroupSchema
>;

// ============================================================================
// FIM DO ARQUIVO
// ============================================================================
