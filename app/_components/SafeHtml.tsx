"use client";

import DOMPurify from "isomorphic-dompurify";
import { SANITIZE_CONFIGS, type SanitizeContext } from "@/lib/security/content/sanitize.config";

/**
 * ============================================================================
 * COMPONENTE: SafeHtml (Onda 2 - E2.2)
 * ============================================================================
 * * OBJETIVO:
 * Renderizar HTML de forma segura no lado do cliente.
 * Atua como "cinto e suspensório" (defesa em profundidade): mesmo que o 
 * backend já tenha sanitizado o input, repetimos a higienização no momento 
 * da renderização para cobrir falhas de injeção direta no SSR.
 * * * REGRA ARQUITETURAL (Camada C10):
 * O uso direto de `dangerouslySetInnerHTML` fora deste componente fica 
 * ESTRITAMENTE PROIBIDO na aplicação inteira.
 * ============================================================================
 */

interface SafeHtmlProps {
  html: string;
  context: SanitizeContext;
  className?: string; // Permite aplicar estilização do Tailwind
}

export function SafeHtml({ html, context, className = "" }: SafeHtmlProps) {
  // 1. Recupera as regras estritas para o contexto solicitado ("article", "comment", etc.)
  const config = SANITIZE_CONFIGS[context];
  
  // 2. Executa a limpeza final usando o isomorphic-dompurify
  const cleanHtml = DOMPurify.sanitize(html, config) as unknown as string;

  // 3. Renderiza o HTML limpo
  return (
    <div 
      className={className}
      dangerouslySetInnerHTML={{ __html: cleanHtml }} 
    />
  );
}