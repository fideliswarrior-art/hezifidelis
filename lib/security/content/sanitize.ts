import DOMPurify from "isomorphic-dompurify";
import { SANITIZE_CONFIGS, type SanitizeContext } from "./sanitize.config";

/**
 * ============================================================================
 * MÓDULO: Motor de Sanitização Server-Side (Onda 2 - E2.2)
 * ============================================================================
 * * OBJETIVO:
 * Executar a limpeza de payloads HTML utilizando as allowlists definidas 
 * em `sanitize.config.ts`. Este módulo blinda a Camada C10 (Conteúdo/Mídia) 
 * da Matriz de Defesa contra Stored XSS.
 * * * DECISÕES DE ARQUITETURA:
 * 1. Prevenção de DoS (Denial of Service): Payloads absurdamente grandes 
 * (> 100KB) são rejeitados antes mesmo de passarem pelo parser do 
 * DOMPurify, poupando CPU do servidor de ataques de exaustão de recursos.
 * 2. Integração com Wrappers: A classe `SanitizeError` define um `statusCode = 422`. 
 * Os wrappers `safe-route.ts` e `safe-action.ts` capturarão esse erro 
 * automaticamente, formatando a resposta HTTP correta.
 * ============================================================================
 */

export class SanitizeError extends Error {
  statusCode = 422;
  code = "SANITIZE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "SanitizeError";
  }
}

/**
 * Sanitiza HTML/texto de acordo com o contexto especificado.
 * Garante que nenhuma tag maliciosa (<script>, atributos on*) chegue ao banco.
 * * @param dirty A string HTML suja enviada pelo usuário.
 * @param context O contexto de inserção (ex: "article", "comment").
 * @returns A string HTML limpa e segura.
 */
export function sanitizeHtml(dirty: string, context: SanitizeContext): string {
  if (typeof dirty !== "string") {
    throw new SanitizeError("O input para sanitização deve ser uma string.");
  }
  
  // Proteção contra DoS: Limite rígido de 100KB para processamento
  if (dirty.length > 100_000) {
    throw new SanitizeError("O input excede o limite máximo permitido de 100KB.");
  }

  const config = SANITIZE_CONFIGS[context];
  
  // O DOMPurify com a tipagem do isomorphic-dompurify pode retornar um TrustedHTML 
  // dependendo do ambiente. Forçamos o cast para string, que é o formato esperado pelo Prisma.
  return DOMPurify.sanitize(dirty, config) as unknown as string;
}

/**
 * Versão extrema da sanitização que remove ABSOLUTAMENTE TODAS as tags e atributos.
 * Ideal para campos como `MatchEvent.note`, `MatchEvent.voidReason` ou resumos curtos.
 * * @param dirty A string suja.
 * @param maxLen Tamanho máximo permitido (default 10.000 caracteres).
 * @returns Apenas o texto puro.
 */
export function sanitizePlainText(dirty: string, maxLen = 10_000): string {
  if (typeof dirty !== "string") {
    throw new SanitizeError("O input para sanitização deve ser uma string.");
  }
  
  if (dirty.length > maxLen) {
    throw new SanitizeError(`O input excede o limite máximo permitido de ${maxLen} caracteres.`);
  }

  // Aniquilação total: nenhuma tag, nenhum atributo.
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as unknown as string;
}