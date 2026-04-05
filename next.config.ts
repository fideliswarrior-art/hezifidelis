import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Diz ao empacotador (Turbopack/Webpack) para não tentar embutir 
  // essas bibliotecas nativas no bundle do servidor.
  serverExternalPackages: [
    "pg",               // Driver do PostgreSQL
    "@prisma/client",   // ORM
    "argon2"            // Criptografia pesada de senhas (C++ bindings)
  ],
  
  // Como a sua plataforma terá Perfis de Jogadores e Times no futuro,
  // já deixamos a configuração de imagens engatilhada para aceitar URLs externas.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**", // Permite imagens de qualquer domínio seguro (ajustaremos isso depois para o seu bucket da AWS/Vercel Blob)
      },
    ],
  },
};

export default nextConfig;