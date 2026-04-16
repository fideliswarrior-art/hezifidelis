/**
 * ============================================================================
 * MÓDULO: Configuração Declarativa da Política CSP
 * ============================================================================
 * * OBJETIVO:
 * Centralizar todas as diretivas do Content Security Policy, separando 
 * rigorosamente o que é permitido em Desenvolvimento vs. Produção.
 * * DECISÕES DE ARQUITETURA E SEGURANÇA (Camada C10 da Matriz de Defesa):
 * 1. Fim do 'unsafe-inline' em Scripts: Em produção, scripts inline só 
 * rodam se possuírem o nonce criptográfico da requisição.
 * 2. 'strict-dynamic': Essencial para o Next.js (App Router). Permite que 
 * scripts confiáveis (que possuem o nonce) carreguem outros chunks de 
 * código dinamicamente sem quebrarmos a hidratação do React.
 * 3. Ambiente de Desenvolvimento: O Hot Module Replacement (HMR) e o 
 * Fast Refresh do Next.js dependem de conexões WebSocket (`ws:`) e do 
 * uso de `'unsafe-eval'`. Por isso, isolamos essas permissões para que 
 * NUNCA vazem para produção.
 * 4. Tailwind CSS (Atenção): Como o Tailwind v4 injeta estilos inline, 
 * mantemos `'unsafe-inline'` em `style-src`. Uma migração para hashes 
 * ou nonces em estilos está mapeada para a Fase 4 (Hardening).
 * * FLUXO DE EXECUÇÃO (`buildCspHeader`):
 * O middleware passa o nonce recém-gerado para a função `buildCspHeader`, 
 * que faz um "find and replace" no placeholder `{NONCE}` das diretivas, 
 * montando a string final que irá compor o header HTTP `Content-Security-Policy`.
 */

/**
 * Política CSP declarativa.
 * Em desenvolvimento permitimos ws: e algumas origens extras do Next HMR.
 * Em produção bloqueamos tudo que não for explícito.
 */
export const CSP_DIRECTIVES = {
  production: {
    "default-src": ["'self'"],
    // nonce substitui unsafe-inline; strict-dynamic permite cadeias de load seguras
    "script-src": ["'self'", "'nonce-{NONCE}'", "'strict-dynamic'"],
    // Tailwind v4 injeta estilos inline. Uma migração para hash fica para a Onda 9.
    "style-src": ["'self'", "'unsafe-inline'"], 
    "img-src": ["'self'", "https:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  },
  development: {
    "default-src": ["'self'"],
    // HMR do Next.js exige eval em dev mode
    "script-src": ["'self'", "'nonce-{NONCE}'", "'strict-dynamic'", "'unsafe-eval'"], 
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "https:", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", "ws:", "wss:"], // Necessário para o Fast Refresh
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  },
} as const;

/**
 * Constrói a string final do header CSP substituindo o placeholder pelo nonce real.
 */
export function buildCspHeader(nonce: string, env: "production" | "development"): string {
  const directives = CSP_DIRECTIVES[env];
  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      const resolved = values.map((v: string) => v.replace("{NONCE}", nonce));
      return `${key} ${resolved.join(" ")}`;
    })
    .join("; ");
}