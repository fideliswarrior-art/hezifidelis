import { NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireAuth } from "@/lib/security/guards/require-auth";
import {
  exportUserData,
  anonymizeUser,
  correctUserData,
} from "@/lib/services/privacy/data-subject.service";
import { z } from "zod";
import { getClientIp } from "@/lib/security/utils/get-ip";

/**
 * ============================================================================
 * ROTA: Gestão de Dados Pessoais (Onda 2 - E2.6)
 * ============================================================================
 * Implementa os direitos do Artigo 18º da LGPD:
 * - GET: Portabilidade dos dados (Exportação Completa).
 * - PATCH: Correção de dados incompletos, inexatos ou desatualizados.
 * - DELETE: Direito ao Esquecimento (Anonimização Irreversível).
 * ============================================================================
 */

// Schema para validação da anonimização (exige confirmação textual)
const anonymizeSchema = z.object({
  reason: z
    .string()
    .min(5, "Por favor, indique um motivo com pelo menos 5 caracteres."),
  confirmation: z.string().refine((val) => val === "CONFIRMAR", {
    message:
      "Deve digitar exatamente 'CONFIRMAR' para prosseguir com a exclusão.",
  }),
});

// Schema para correção de dados (apenas campos permitidos - Anti Mass-Assignment)
const updateDataSchema = z.object({
  name: z
    .string()
    .min(3, "O nome deve ter pelo menos 3 caracteres.")
    .max(100)
    .optional(),
  bio: z
    .string()
    .max(500, "A bio não pode exceder 500 caracteres.")
    .nullable()
    .optional(),
  avatarUrl: z.string().url("URL de avatar inválida.").nullable().optional(),
});

/**
 * Exportação de Dados (Portabilidade)
 * Protegida por Rate Limit estrito (5/hora) para evitar abuso de recursos.
 */
export const GET = safeRoute(
  async () => {
    // 1. Camada C1 - Autenticação Zero Trust
    const session = await requireAuth();

    // 2. Camada C13 - Processamento de Privacidade
    const data = await exportUserData(session.userId);

    return NextResponse.json({
      success: true,
      data,
      message:
        "Exportação gerada com sucesso. Este ficheiro contém todos os seus dados identificáveis.",
    });
  },
  { rateLimitBucket: "dataExport" },
);

/**
 * Correção de Dados (Art. 18, III)
 * Permite ao titular atualizar informações básicas de cadastro.
 */
export const PATCH = safeRoute(
  async (req) => {
    // 1. Camada C1 - Autenticação
    const session = await requireAuth();

    // 2. Validação Zod (Anti Mass-Assignment)
    const body = await req.json().catch(() => ({}));
    const parsedData = updateDataSchema.parse(body);

    // 3. Limpeza do objeto para satisfazer o 'exactOptionalPropertyTypes: true'
    // Passamos adiante apenas as chaves que realmente têm algum valor (mesmo que seja null)
    const cleanData: {
      name?: string;
      bio?: string | null;
      avatarUrl?: string | null;
    } = {};
    if (parsedData.name !== undefined) cleanData.name = parsedData.name;
    if (parsedData.bio !== undefined) cleanData.bio = parsedData.bio;
    if (parsedData.avatarUrl !== undefined)
      cleanData.avatarUrl = parsedData.avatarUrl;

    // 4. Execução via Service (Gera AuditLog automaticamente)
    const updatedUser = await correctUserData(session.userId, cleanData);

    return NextResponse.json({
      success: true,
      data: {
        name: updatedUser.name,
        bio: updatedUser.bio,
        avatarUrl: updatedUser.avatarUrl,
      },
      message: "Dados atualizados com sucesso.",
    });
  },
  { rateLimitBucket: "authRead" },
);

/**
 * Anonimização de Conta (Esquecimento)
 * Transforma PII em dados anónimos e encerra todas as sessões ativas.
 */
export const DELETE = safeRoute(
  async (req) => {
    // 1. Camada C1 - Autenticação
    const session = await requireAuth();

    // 2. Validação de Intenção (Anti-acidente)
    const body = await req.json().catch(() => ({}));
    const { reason } = anonymizeSchema.parse(body);

    // 3. Execução do "Hardening" de Privacidade
    await anonymizeUser(session.userId, reason, session.userId);

    return NextResponse.json({
      success: true,
      message:
        "A sua conta foi anonimizada com sucesso. Todas as suas sessões foram encerradas.",
    });
  },
  { rateLimitBucket: "adminWrite" },
);
