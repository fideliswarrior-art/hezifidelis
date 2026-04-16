/**
 * ============================================================================
 * MÓDULO: Geração de Nonce para CSP (Content Security Policy)
 * ============================================================================
 * * OBJETIVO:
 * Fornecer um identificador único, imprevisível e de uso único (nonce) 
 * para ser injetado nos cabeçalhos HTTP e nas tags <script> do frontend. 
 * Isso permite bloquear a execução de scripts maliciosos (XSS) ao exigir 
 * que todo script inline possua este nonce exato para ser executado.
 * * DECISÕES DE ARQUITETURA:
 * 1. Compatibilidade com Edge: Utilizamos a Web Crypto API nativa 
 * (`crypto.getRandomValues`) em vez de `node:crypto`. Isso é mandatório 
 * porque este código roda no middleware (`proxy.ts`), que utiliza o 
 * Edge Runtime do Next.js.
 * 2. Entropia: Geramos 18 bytes (144 bits), o que excede as recomendações 
 * padrões de segurança para evitar adivinhação.
 * 3. Codificação Base64URL: O nonce precisa trafegar nos headers HTTP. 
 * Substituímos caracteres problemáticos (+, /, =) para garantir que o 
 * header não seja quebrado ou mal interpretado pelo navegador ou proxies.
 * * USO:
 * Chamado uma única vez por requisição pelo `proxy.ts`. O valor NUNCA deve
 * ser reaproveitado entre requisições ou usuários diferentes.
 */

/**
 * Utilitário para geração de Nonce compatível com Edge Runtime.
 * NÃO utiliza o módulo "node:crypto" para manter a compatibilidade total 
 * com o Middleware do Next.js (Edge Runtime).
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(18); // 144 bits de entropia
  crypto.getRandomValues(bytes);
  
  // Codificação base64url (segura para headers, sem caracteres especiais + / =)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}