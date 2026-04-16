import type { NextConfig } from "next";

// =============================================================================
// HEZI TECH — CONFIGURAÇÃO NEXT.JS 16 (ATUALIZADO ONDA 2)
// =============================================================================
// Referências de segurança:
//   • OWASP Secure Headers Project
//   • Mozilla Observatory (Meta: A+)
//   • HEZI_TECH_Planejamento_Estratégico_Segurança — Eixo 5 (E5.1, E5.2)
//   • Matriz de Defesa — Camadas C10 (Conteúdo), C11 (Abuso), C13 (Privacidade)
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
  // 2. CONFIGURAÇÃO DE IMAGENS (Endurecimento E2.5)
  // ---------------------------------------------------------------------------
  // A plataforma terá Perfis de Jogadores e Times. 
  // ATUALIZAÇÃO ONDA 2: Substituído o wildcard "**" por domínios específicos 
  // dos provedores candidatos para evitar abusos de proxy de imagem (SSRF).
  // ---------------------------------------------------------------------------
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" }, // Cloudflare R2
      { protocol: "https", hostname: "*.s3.amazonaws.com" },        // AWS S3
      { protocol: "https", hostname: "*.supabase.co" },             // Supabase Storage
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. SECURITY HEADERS (Eixo 5 — E5.1 e E5.2)
  // ---------------------------------------------------------------------------
  // Aplicados em TODAS as rotas da aplicação via cabeçalhos HTTP.
  // ---------------------------------------------------------------------------
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [

          // -----------------------------------------------------------------
          // HSTS — Strict-Transport-Security
          // -----------------------------------------------------------------
          // Força o navegador a usar HTTPS por 2 anos.
          // Mitigação: Man-in-the-Middle (MITM), SSL Stripping
          // -----------------------------------------------------------------
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          },

          // -----------------------------------------------------------------
          // X-Frame-Options
          // -----------------------------------------------------------------
          // Impede clickjacking ao proibir o site em iframes.
          // -----------------------------------------------------------------
          {
            key: "X-Frame-Options",
            value: "DENY"
          },

          // -----------------------------------------------------------------
          // X-Content-Type-Options
          // -----------------------------------------------------------------
          // Força o navegador a respeitar o MIME-type declarado (bloqueia sniffing).
          // -----------------------------------------------------------------
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },

          // -----------------------------------------------------------------
          // Referrer-Policy
          // -----------------------------------------------------------------
          // Controla o envio da URL de origem em navegações externas.
          // -----------------------------------------------------------------
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },

          // -----------------------------------------------------------------
          // Permissions-Policy
          // -----------------------------------------------------------------
          // Desabilita APIs de hardware e privacidade não utilizadas.
          // -----------------------------------------------------------------
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()"
          },

          // -----------------------------------------------------------------
          // Cross-Origin-Opener-Policy (COOP) — NOVO (E2.5)
          // -----------------------------------------------------------------
          // Isola o contexto de navegação, impedindo que outras abas 
          // acessem informações da janela da aplicação.
          // -----------------------------------------------------------------
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin"
          },

          // -----------------------------------------------------------------
          // Cross-Origin-Resource-Policy (CORP) — NOVO (E2.5)
          // -----------------------------------------------------------------
          // Impede que recursos do site sejam carregados por domínios de terceiros.
          // -----------------------------------------------------------------
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin"
          },

          // -----------------------------------------------------------------
          // NOTA SOBRE CSP (Diferencial Onda 2):
          // O cabeçalho Content-Security-Policy foi REMOVIDO deste arquivo.
          // Ele agora é gerado dinamicamente no proxy.ts para permitir o uso 
          // de um Nonce criptográfico único por requisição, eliminando a 
          // necessidade de 'unsafe-inline'.
          // -----------------------------------------------------------------

          // -----------------------------------------------------------------
          // X-DNS-Prefetch-Control
          // -----------------------------------------------------------------
          {
            key: "X-DNS-Prefetch-Control",
            value: "on"
          },

          // -----------------------------------------------------------------
          // X-Permitted-Cross-Domain-Policies
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
  // Remove "X-Powered-By: Next.js" para dificultar o reconhecimento da stack.
  // ---------------------------------------------------------------------------
  poweredByHeader: false,
};

export default nextConfig;