import DOMPurify from "isomorphic-dompurify";

/**
 * ============================================================================
 * MÓDULO: Sanitização Dedicada de SVG (Onda 2 - E2.3)
 * ============================================================================
 * * OBJETIVO:
 * Arquivos SVG não são imagens binárias, são documentos XML. Por isso, 
 * eles aceitam tags <script>, <foreignObject> e eventos inline (onload, etc.), 
 * tornando-os vetores clássicos de XSS (Cross-Site Scripting). 
 * Este módulo realiza uma limpeza brutal para garantir que o SVG contenha 
 * apenas vetores gráficos inofensivos.
 * * * DECISÕES DE SEGURANÇA (Camada C10 da Matriz de Defesa):
 * 1. Limite de Tamanho de Processamento: Rejeita SVGs maiores que 500KB 
 * antes do parsing para evitar DoS (exaustão de CPU/RAM).
 * 2. Perfil Estrito: Ativa apenas os perfis 'svg' e 'svgFilters' do DOMPurify.
 * 3. Bloqueio de Links Externos: O atributo 'href' é banido para impedir 
 * que o SVG carregue payloads maliciosos de domínios externos via 'xlink:href'.
 * 4. Fail-Safe Regex: Após a sanitização, fazemos uma última verificação 
 * usando Regex. Se qualquer resquício de '<script' for detectado, o 
 * arquivo é completamente rejeitado.
 * ============================================================================
 */
export function sanitizeSvg(svgSource: string): string {
  // 1. Prevenção de DoS no parsing XML
  if (svgSource.length > 500_000) {
    throw new Error("SVG excede o tamanho máximo de processamento (500KB).");
  }

  // 2. Sanitização agressiva via DOMPurify
  const clean = DOMPurify.sanitize(svgSource, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: [
      "onload", "onclick", "onerror", "onmouseover", "onfocus", "onblur",
      "onanimationstart", "onanimationend", "onanimationiteration",
      "href", // bloqueia xlink:href externos e possíveis javascript: URIs
    ],
  });

  // 3. Verificação final (Fail-Safe)
  // Se por alguma anomalia do parser o script sobreviver, nós barramos a execução aqui.
  if (/<script/i.test(clean as unknown as string)) {
    throw new Error("Conteúdo malicioso (script) detectado no SVG após a sanitização.");
  }

  return clean as unknown as string;
}