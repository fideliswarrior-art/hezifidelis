import { NextResponse } from "next/server";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { requireAuth } from "@/lib/security/guards/require-auth";
import {
  listConsents,
  grantConsent,
  revokeConsent,
} from "@/lib/services/privacy/consent.service";
import { ConsentPurpose } from "@prisma/client";
import { getClientIp } from "@/lib/security/utils/get-ip";
import { z } from "zod";

/**
 * ============================================================================
 * ROTA: Gestão de Consentimentos LGPD (Onda 2 - E2.6)
 * ============================================================================
 * Permite ao utilizador gerir as suas preferências de privacidade:
 * - GET: Lista todos os consentimentos (concedidos ou revogados).
 * - POST: Concede um novo consentimento ou reativa um revogado.
 * - DELETE: Revoga um consentimento específico (exceto ESSENTIAL).
 * ============================================================================
 */

// Schema para validação de concessão de consentimento
const grantConsentSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose),
  policyVersion: z.string().min(5, "Versão da política inválida."),
});

// Schema para revogação (apenas a finalidade)
const revokeConsentSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose),
});

/**
 * Listagem de Consentimentos
 * Retorna o histórico de permissões do utilizador autenticado.
 */
export const GET = safeRoute(
  async () => {
    const session = await requireAuth();
    const consents = await listConsents(session.userId);

    return NextResponse.json({
      success: true,
      data: consents,
    });
  },
  { rateLimitBucket: "authRead" },
);

/**
 * Concessão de Consentimento
 * Regista a aceitação de uma finalidade específica com dados forenses (IP/UA).
 */
export const POST = safeRoute(
  async (req) => {
    const session = await requireAuth();

    const body = await req.json().catch(() => ({}));
    const { purpose, policyVersion } = grantConsentSchema.parse(body);

    const ip = await getClientIp();
    const ua = req.headers.get("user-agent") || "unknown";

    const consent = await grantConsent(
      session.userId,
      purpose,
      policyVersion,
      ip,
      ua,
    );

    return NextResponse.json({
      success: true,
      data: consent,
      message: `Consentimento para '${purpose}' registado com sucesso.`,
    });
  },
  { rateLimitBucket: "adminWrite" },
);

/**
 * Revogação de Consentimento
 * Marca um consentimento como não concedido.
 */
export const DELETE = safeRoute(
  async (req) => {
    const session = await requireAuth();

    const body = await req.json().catch(() => ({}));
    const { purpose } = revokeConsentSchema.parse(body);

    const ip = await getClientIp();

    const updated = await revokeConsent(session.userId, purpose, ip);

    return NextResponse.json({
      success: true,
      data: updated,
      message: `Consentimento para '${purpose}' foi revogado.`,
    });
  },
  { rateLimitBucket: "adminWrite" },
);
