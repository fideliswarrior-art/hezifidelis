import type { Metadata } from "next";
import { headers } from "next/headers"; // NOVO: Necessário para ler o nonce
// Importamos uma fonte limpa e moderna do Google Fonts para dar aquela cara de "Overtime Elite"
import { Inter } from "next/font/google"; 
import "./globals.css"; // É AQUI QUE O TAILWIND ENTRA!

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hezi Tech | O Basquete Reinventado",
  description: "A maior liga comunitária do Rio de Janeiro. Estatísticas ao vivo, draft, impacto social.",
};

// =============================================================================
// HEZI TECH — ROOT LAYOUT (ATUALIZADO ONDA 2 - E2.1)
// =============================================================================
// Responsabilidades:
//   1. Configuração visual global (Inter, pt-BR, Dark Mode).
//   2. Propagação do Nonce CSP: Lê o x-nonce gerado no proxy.ts e o disponibiliza
//      para os scripts de hidratação do Next.js.
//
// DOCUMENTAÇÃO DO FLUXO CSP:
// Para que a Content Security Policy dinâmica funcione corretamente blindando 
// a aplicação contra XSS, o ecossistema depende dos seguintes arquivos:
//
//   1. lib/security/csp/nonce.ts: Gera o nonce criptográfico (Web Crypto API).
//   2. lib/security/csp/csp.config.ts: Define as diretivas (production vs dev).
//   3. proxy.ts: O middleware que orquestra a geração, injeta o nonce no header 
//      'x-nonce' da requisição e aplica a 'Content-Security-Policy' na resposta.
//   4. next.config.ts: Onde a CSP estática foi REMOVIDA para não gerar conflito.
//   5. app/layout.tsx (ESTE ARQUIVO): Lê o 'x-nonce' e ativa a engine do Next.js 
//      para aplicá-lo em todas as tags <script> geradas pelo framework.
// =============================================================================

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // --- SEGURANÇA (Onda 2): Recuperação do Nonce ---
  // Acessamos os headers da requisição (injetados pelo proxy.ts).
  // O "await" é necessário no Next.js 15+ para acessar funções assíncronas de servidor.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="pt-BR">
      {/* O antialiased deixa a fonte mais suave e legível */}
      <body className={`${inter.className} antialiased bg-black text-white min-h-screen`}>
        {/* Nota Técnica de Segurança:
            O Next.js detecta a presença do header CSP na resposta (injetado via 
            middleware) e o nonce lido acima. Ele automaticamente propaga esse 
            nonce para os scripts de hidratação (<script>), garantindo que o 
            front-end funcione sob a regra 'strict-dynamic' sem 'unsafe-inline'.
            
            Se houver scripts externos manuais no futuro (ex: Analytics), 
            eles devem receber o nonce explicitamente:
            <Script src="..." nonce={nonce} />
        */}
        {children}
      </body>
    </html>
  );
}