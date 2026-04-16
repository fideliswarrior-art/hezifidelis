import type { Config } from "dompurify";

/**
 * ============================================================================
 * MÓDULO: Configurações e Allowlists de Sanitização (DOMPurify)
 * ============================================================================
 * * OBJETIVO (Onda 2 - E2.2):
 * Prevenir ataques de Stored XSS (Cross-Site Scripting). Este arquivo define 
 * as "Allowlists" (listas de permissões) estritas para diferentes contextos 
 * de inserção de texto na plataforma Hezi Tech.
 * * * REGRA DE SEGURANÇA (Camada C10 da Matriz de Defesa):
 * Tudo o que não estiver explicitamente permitido nesta lista será REMOVIDO 
 * silenciosamente pelo sanitizador antes de tocar no banco de dados. 
 * Nenhuma tag <script>, <style> ou atributo de evento (onclick, onerror) 
 * sobreviverá a este filtro.
 * ============================================================================
 */

// Define os contextos válidos de sanitização na plataforma
export type SanitizeContext = "article" | "campaign_update" | "comment" | "plain";

export const SANITIZE_CONFIGS: Record<SanitizeContext, Config> = {
  
  // --------------------------------------------------------------------------
  // CONTEXTO: Artigos Editoriais (Rich Text)
  // Uso: `Article.content` criado por usuários com role EDITOR ou superior.
  // Permite formatação rica para matérias jornalísticas, tabelas e imagens, 
  // mas bloqueia estritamente qualquer vetor de execução de código.
  // --------------------------------------------------------------------------
  article: {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s",
      "h1", "h2", "h3", "h4",
      "ul", "ol", "li",
      "a", "blockquote", "code", "pre",
      "img", "figure", "figcaption",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
    // Impede `javascript:alert(1)` em hrefs. Permite http, https, mailto, tel.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    // Lista negra explícita (defense in depth)
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "onclick", "onerror", "onload", "onmouseover", "onfocus", "onblur"],
  },

  // --------------------------------------------------------------------------
  // CONTEXTO: Atualização de Campanha Beneficente
  // Uso: `CampaignUpdate.content`. 
  // Mais restrito que artigos. Permite apenas formatação básica de texto 
  // e links seguros (apenas HTTP/HTTPS) para informar os doadores.
  // --------------------------------------------------------------------------
  campaign_update: {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "ul", "ol", "li", "a"],
    ALLOWED_ATTR: ["href", "title"],
    // Restrição extrema de URI: Apenas links HTTPS/HTTP. Sem mailto ou tel.
    ALLOWED_URI_REGEXP: /^https?:\/\//,
  },

  // --------------------------------------------------------------------------
  // CONTEXTO: Comentários de Usuários
  // Uso: `Comment.content`.
  // Contexto de altíssimo risco (input público). Permitimos apenas formatação 
  // de ênfase para evitar quebras de layout ou injeção de links maliciosos 
  // (phishing) nos artigos da liga.
  // --------------------------------------------------------------------------
  comment: {
    ALLOWED_TAGS: ["p", "br", "strong", "em"],
    ALLOWED_ATTR: [], // NENHUM atributo permitido (zero links, zero imagens)
  },

  // --------------------------------------------------------------------------
  // CONTEXTO: Texto Puro (Plain Text)
  // Uso: `MatchEvent.note`, `MatchEvent.voidReason`, resumos curtos.
  // Remove QUALQUER tag HTML. Garante que o input seja 100% texto puro.
  // --------------------------------------------------------------------------
  plain: {
    ALLOWED_TAGS: [], // Aniquila todas as tags
    ALLOWED_ATTR: [], // Aniquila todos os atributos
  },
} as const;