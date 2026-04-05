import type { Metadata } from "next";
// Importamos uma fonte limpa e moderna do Google Fonts para dar aquela cara de "Overtime Elite"
import { Inter } from "next/font/google"; 
import "./globals.css"; // É AQUI QUE O TAILWIND ENTRA!

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hezi Tech | O Basquete Reinventado",
  description: "A maior liga comunitária do Rio de Janeiro. Estatísticas ao vivo, draft, impacto social.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      {/* O antialiased deixa a fonte mais suave e legível */}
      <body className={`${inter.className} antialiased bg-black text-white min-h-screen`}>
        {children}
      </body>
    </html>
  );
}