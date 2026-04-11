import type { NextConfig } from "next";

// =============================================================================
// HEZI TECH — CONFIGURAÇÃO NEXT.JS 16
// =============================================================================
// Referências de segurança:
//   • OWASP Secure Headers Project
//   • Mozilla Observatory
//   • HEZI_TECH_Planejamento_Estratégico_Segurança — Eixo 5 (E5.1, E5.2)
//   • Matriz de Defesa — Camada C10 (Conteúdo/Mídia)
//
// Camadas de Defesa impactadas: C10, C11, C13
// Artigos LGPD atendidos: Art. 6º VII (Segurança), Art. 46 (Medidas técnicas)
// =============================================================================

const nextConfig: NextConfig = {

  // ---------------------------------------------------------------------------
  // 1. PACOTES NATIVOS EXTERNALIZADOS
  // ---------------------------------------------------------------------------
  // Diz ao empacotador (Turbopack/Webpack) para não tentar embutir 
  // essas bibliotecas nativas no bundle do servidor.
  serverExternalPackages: [
    "pg",               // Driver do PostgreSQL (C bindings)
    "@prisma/client",   // ORM — código gerado não deve ser bundled
    "argon2"            // Criptografia pesada de senhas (C++ bindings)
  ],

  // ---------------------------------------------------------------------------
  // 2. CONFIGURAÇÃO DE IMAGENS
  // ---------------------------------------------------------------------------
  // A plataforma terá Perfis de Jogadores e Times no futuro.
  // Configuração engatilhada para aceitar URLs externas.
  // TODO: Restringir hostname para o bucket definitivo (AWS S3 / Cloudflare R2)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. SECURITY HEADERS (Eixo 5 — E5.1 e E5.2)
  // ---------------------------------------------------------------------------
  // Aplicados em TODAS as rotas da aplicação.
  // Cada header inclui referência ao risco que mitiga.
  //
  // NOTA SOBRE CSP:
  //   O Next.js App Router injeta scripts inline para hidratação e 
  //   carregamento de chunks. Por isso, usamos 'unsafe-inline' para scripts
  //   neste arquivo. Para uma CSP com nonce (mais restritiva), a geração 
  //   do nonce por request deve ser feita no proxy.ts (middleware Edge).
  //   Isso será implementado na Onda 2 como evolução.
  //
  //   Referência: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
  // ---------------------------------------------------------------------------
  async headers() {
    return [
      {
        // Aplica a TODAS as rotas (páginas, API, assets)
        source: "/(.*)",
        headers: [

          // -----------------------------------------------------------------
          // HSTS — Strict-Transport-Security
          // -----------------------------------------------------------------
          // Força o navegador a usar HTTPS por 2 anos, incluindo subdomínios.
          // O 'preload' permite inclusão na lista de pré-carregamento dos browsers.
          //
          // Mitigação: Man-in-the-Middle (MITM), SSL Stripping
          // Referência: OWASP — Transport Layer Security Cheat Sheet
          // -----------------------------------------------------------------
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          },

          // -----------------------------------------------------------------
          // X-Frame-Options
          // -----------------------------------------------------------------
          // Impede que a aplicação seja embutida em <iframe>, <frame> ou <object>
          // de qualquer origem.
          //
          // Mitigação: Clickjacking
          // Referência: OWASP — Clickjacking Defense Cheat Sheet
          // -----------------------------------------------------------------
          {
            key: "X-Frame-Options",
            value: "DENY"
          },

          // -----------------------------------------------------------------
          // X-Content-Type-Options
          // -----------------------------------------------------------------
          // Impede o navegador de "adivinhar" o tipo MIME de um recurso.
          // Força o uso do Content-Type declarado pelo servidor.
          //
          // Mitigação: MIME Confusion Attack, Drive-by Download
          // Referência: OWASP — MIME Sniffing
          // -----------------------------------------------------------------
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },

          // -----------------------------------------------------------------
          // Referrer-Policy
          // -----------------------------------------------------------------
          // Controla quanta informação de URL é enviada no header Referer
          // em navegações cross-origin. 'strict-origin-when-cross-origin' envia
          // apenas a origem (sem path) em requisições cross-origin, e a URL 
          // completa para same-origin.
          //
          // Mitigação: Vazamento de URLs internas com tokens/IDs sensíveis
          // Referência: MDN — Referrer-Policy
          // -----------------------------------------------------------------
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },

          // -----------------------------------------------------------------
          // Permissions-Policy (antigo Feature-Policy)
          // -----------------------------------------------------------------
          // Desabilita APIs do navegador que a aplicação não utiliza.
          // Impede que scripts de terceiros (caso existam no futuro)
          // acessem câmera, microfone, geolocalização, etc.
          //
          // Mitigação: Abuso de APIs sensíveis do navegador por scripts injetados
          // Referência: W3C — Permissions Policy
          //
          // NOTA: Quando integrar mapas de quadras (Venue.latitude/longitude),
          //       ajustar geolocation para geolocation=(self) se necessário.
          // -----------------------------------------------------------------
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()"
          },

          // -----------------------------------------------------------------
          // Content-Security-Policy (CSP)
          // -----------------------------------------------------------------
          // Define quais origens são confiáveis para cada tipo de recurso.
          // Esta é a primeira linha de defesa contra XSS.
          //
          // Diretivas configuradas:
          //   default-src 'self'         → Fallback: só aceita recursos do próprio domínio
          //   script-src 'self' 'unsafe-inline' 'unsafe-eval' → Next.js precisa para hidratação
          //   style-src 'self' 'unsafe-inline'  → Tailwind injeta estilos inline
          //   img-src 'self' https: data:       → Imagens do domínio, HTTPS externas e data URIs (QR Code base64)
          //   font-src 'self'                    → Fontes apenas do próprio domínio (Inter via next/font)
          //   connect-src 'self'                 → Fetch/XHR apenas para o próprio domínio
          //   frame-ancestors 'none'             → Reforça X-Frame-Options (clickjacking)
          //   form-action 'self'                 → Forms só podem submeter para o próprio domínio
          //   base-uri 'self'                    → Impede injeção de <base> tag
          //   object-src 'none'                  → Bloqueia <object>, <embed>, <applet>
          //   upgrade-insecure-requests           → Converte HTTP → HTTPS automaticamente
          //
          // Mitigação: Cross-Site Scripting (XSS), Data Injection
          // Referência: OWASP — Content Security Policy Cheat Sheet
          //
          // EVOLUÇÃO PLANEJADA (Onda 2):
          //   Substituir 'unsafe-inline' e 'unsafe-eval' em script-src por
          //   nonce dinâmico gerado no proxy.ts (middleware Edge Runtime).
          //   Isso exige: gerar nonce por request → injetar no header CSP →
          //   passar para o layout.tsx via <Script nonce={nonce}>.
          // -----------------------------------------------------------------
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' https: data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "upgrade-insecure-requests"
            ].join("; ")
          },

          // -----------------------------------------------------------------
          // X-DNS-Prefetch-Control
          // -----------------------------------------------------------------
          // Habilita prefetch de DNS para links na página.
          // Melhora performance sem impacto de segurança quando combinado
          // com os demais headers (CSP já restringe connect-src).
          //
          // Referência: MDN — X-DNS-Prefetch-Control
          // -----------------------------------------------------------------
          {
            key: "X-DNS-Prefetch-Control",
            value: "on"
          },

          // -----------------------------------------------------------------
          // X-Permitted-Cross-Domain-Policies
          // -----------------------------------------------------------------
          // Impede que plugins como Flash/Acrobat leiam dados cross-domain
          // via arquivos crossdomain.xml. Apesar de Flash estar descontinuado,
          // é uma boa prática defensiva que custa zero performance.
          //
          // Mitigação: Cross-domain data leaking via plugins legados
          // -----------------------------------------------------------------
          {
            key: "X-Permitted-Cross-Domain-Policies",
            value: "none"
          },
        ],
      },
    ];
  },

  // ---------------------------------------------------------------------------
  // 4. POWERED-BY HEADER
  // ---------------------------------------------------------------------------
  // Remove o header "X-Powered-By: Next.js" das respostas.
  // Informação de stack tecnológica facilita reconnaissance por atacantes.
  //
  // Mitigação: Information Disclosure / Fingerprinting
  // ---------------------------------------------------------------------------
  poweredByHeader: false,
};

export default nextConfig;