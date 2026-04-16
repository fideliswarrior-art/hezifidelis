import { fileTypeFromBuffer } from "file-type";
import { matchesMagicBytes } from "./magic-bytes";
import { UPLOAD_CONTEXTS, type UploadContext } from "./mime.config";

/**
 * ============================================================================
 * MÓDULO: Motor de Validação de Uploads (Onda 2 - E2.3)
 * ============================================================================
 * * OBJETIVO:
 * Orquestrar a validação em múltiplas camadas de qualquer arquivo enviado 
 * para a plataforma. Ignora a extensão fornecida pelo usuário e o Content-Type 
 * da requisição, confiando apenas na análise binária profunda (Magic Bytes).
 * * * DECISÕES DE ARQUITETURA (Camada C10):
 * 1. Fail-Fast por Tamanho: Rejeita arquivos gigantes antes de processar 
 * os bytes, economizando CPU e RAM.
 * 2. Tratamento Especial de SVG: Como SVG é texto (XML) e não binário, 
 * ele bypassa a checagem de magic bytes aqui, mas sinaliza ao chamador 
 * que a sanitização XML obrigatória deve ser aplicada.
 * 3. Integração com Wrappers: Erros lançam `UploadValidationError` (HTTP 422), 
 * que é tratado nativamente pelo `safe-action.ts` e `safe-route.ts`.
 * ============================================================================
 */

export class UploadValidationError extends Error {
  statusCode = 422;
  code = "UPLOAD_INVALID";
  constructor(message: string, public detail?: Record<string, unknown>) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/**
 * Valida o buffer de um arquivo recebido. Retorna o MIME e a extensão canônicos 
 * detectados (a fonte da verdade), ignorando os declarados pelo cliente.
 * * @param buffer O conteúdo do arquivo em memória.
 * @param declaredMime O Content-Type que o frontend/cliente disse que é.
 * @param context O local onde o arquivo será usado (ex: "avatar", "product_image").
 * @returns Objeto contendo a extensão e o MIME reais detectados.
 */
export async function validateUpload(
  buffer: Buffer,
  declaredMime: string,
  context: UploadContext
): Promise<{ canonicalMime: string; canonicalExtension: string }> {
  const cfg = UPLOAD_CONTEXTS[context];

  // 1. CAMADA 1: Validação de Tamanho (Prevenção de DoS)
  if (buffer.byteLength > cfg.maxSizeBytes) {
    throw new UploadValidationError("Arquivo excede tamanho máximo permitido para este contexto.", {
      received: buffer.byteLength,
      max: cfg.maxSizeBytes,
    });
  }

  // 2. CAMADA 2: Caso Especial - SVG (Texto XML)
  // O SVG só passa se o contexto explicitamente permitir (ex: team_logo).
  if (declaredMime === "image/svg+xml" && (cfg.allowedMimes as readonly string[]).includes("image/svg+xml")) {
    // ATENÇÃO: O serviço que chamou esta função DEVE invocar sanitizeSvg() em seguida!
    return { canonicalMime: "image/svg+xml", canonicalExtension: "svg" };
  }

  // 3. CAMADA 3: Detecção Dinâmica por Magic Bytes (via file-type)
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    throw new UploadValidationError("Não foi possível detectar o formato real do arquivo binário.");
  }

  // 4. CAMADA 4: Cross-check de Segurança (Defesa em Profundidade)
  // Comparamos o que a biblioteca detectou com o nosso dicionário imutável.
  if (!matchesMagicBytes(buffer, detected.mime)) {
    throw new UploadValidationError("A assinatura binária (Magic Bytes) é inconsistente com o formato detectado.", {
      detected: detected.mime,
    });
  }

  // 5. CAMADA 5: Validação contra a Allowlist do Contexto
  if (!(cfg.allowedMimes as readonly string[]).includes(detected.mime)) {
    throw new UploadValidationError("Tipo de arquivo não permitido neste contexto específico.", {
      detected: detected.mime,
      allowed: cfg.allowedMimes,
    });
  }

  // Se sobreviveu a todas as camadas, o arquivo é válido.
  // Retornamos os dados canônicos que serão usados para renomear o arquivo final.
  return { canonicalMime: detected.mime, canonicalExtension: detected.ext };
}