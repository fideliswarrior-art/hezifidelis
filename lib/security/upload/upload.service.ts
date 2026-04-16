import { createHash } from "node:crypto";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { validateUpload, UploadValidationError } from "./mime";
import { sanitizeSvg } from "./svg-sanitize";
import { hashForAudit, generateOpaqueToken } from "@/lib/security/crypto/qrcode";
import type { UploadContext } from "./mime.config";

/**
 * ============================================================================
 * MÓDULO: Serviço Orquestrador de Uploads (Onda 2 - E2.3)
 * ============================================================================
 * * OBJETIVO:
 * Receber o arquivo bruto, validar (Magic Bytes, Tamanho, MIME), higienizar 
 * (se SVG) e preparar para armazenamento seguro (Bucket S3/R2/Supabase).
 * * * DECISÕES DE SEGURANÇA (Camada C10 da Matriz de Defesa):
 * 1. Nome Canônico: Ignoramos completamente o nome do arquivo enviado pelo 
 * usuário. Ele é renomeado usando um UUID/Token opaco para evitar Path 
 * Traversal (Zip Slip) e injeção de caracteres especiais no storage.
 * 2. Hash de Integridade: Um SHA-256 do arquivo final é gerado para 
 * rastreabilidade absoluta e prevenção de adulteração no storage.
 * 3. Auditoria Completa: Tanto o sucesso (MEDIA_UPLOAD) quanto a tentativa 
 * de ataque (MEDIA_REJECTED) são logados de forma imutável no AuditLog.
 * ============================================================================
 */

export interface UploadInput {
  buffer: Buffer;
  declaredMime: string;
  originalFilename: string;
  context: UploadContext;
  userId: string;
  ip?: string;
}

export interface UploadResult {
  storagePath: string;
  canonicalMime: string;
  canonicalExtension: string;
  sha256: string;
}

/**
 * Processa um upload recebido, validando e preparando para o storage.
 * * @param input Dados do arquivo, contexto da operação e quem enviou.
 * @returns Os metadados do arquivo validado e pronto.
 */
export async function handleUpload(input: UploadInput): Promise<UploadResult> {
  const { buffer, declaredMime, originalFilename, context, userId, ip } = input;

  try {
    // 1. CAMADAS 1 a 5: Validação binária profunda e limites de contexto
    const { canonicalMime, canonicalExtension } = await validateUpload(buffer, declaredMime, context);

    let finalBuffer = buffer;

    // 2. CAMADA 6: Sanitização obrigatória para arquivos XML (SVG)
    if (canonicalMime === "image/svg+xml") {
      const svgText = buffer.toString("utf-8");
      const cleanSvg = sanitizeSvg(svgText);
      finalBuffer = Buffer.from(cleanSvg, "utf-8");
    }

    // 3. Integridade: Hash SHA-256 da versão higienizada/final do arquivo
    const sha256 = createHash("sha256").update(finalBuffer).digest("hex");

    // 4. Prevenção Path Traversal: Geração de nome de arquivo seguro e opaco
    // 16 bytes = 22 caracteres em base64url
    const token = generateOpaqueToken(16); 
    const storagePath = `${context}/${token}.${canonicalExtension}`;

    // 5. [PLACEHOLDER] Persistência no Storage na Nuvem (S3/R2/Supabase)
    // Esta etapa será implementada de fato na Onda 6/7, quando o provedor for definido.
    // await storage.put(storagePath, finalBuffer, { contentType: canonicalMime });

    // 6. Auditoria de Sucesso
    await createAuditLog({
      userId,
      // Obs: Adicionaremos esta constante no arquivo audit.events.ts no próximo passo
      action: AUDIT_EVENTS.MEDIA_UPLOAD as any, 
      entity: "Media",
      entityId: storagePath,
      before: null,
      after: {
        canonicalMime,
        size: finalBuffer.byteLength,
        sha256,
        originalFilenameHash: hashForAudit(originalFilename), // O nome bruto NUNCA é logado
        context,
      },
      ip: ip || null,
    });

    return { storagePath, canonicalMime, canonicalExtension, sha256 };

  } catch (error) {
    // 7. Auditoria de Falha/Ataque (Se for um erro de validação)
    if (error instanceof UploadValidationError || error instanceof Error) {
      // Ignora falhas de infraestrutura, loga apenas validações/sanitizações que falharam
      await createAuditLog({
        userId,
        action: "MEDIA_REJECTED", // Adicionaremos esta constante no próximo passo
        entity: "Media",
        entityId: "-", // Não chegou a ser salvo
        before: null,
        after: {
          reason: error.message,
          declaredMime,
          context,
          originalFilenameHash: hashForAudit(originalFilename),
        },
        ip: ip || null,
      });
    }

    // Repassa o erro para ser tratado pelo wrapper (safe-action / safe-route)
    throw error;
  }
}