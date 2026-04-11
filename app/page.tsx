import Link from "next/link";
import { getSession } from "@/lib/security/auth/session";

export default async function HomePage() {
  // Verifica a sessão no servidor instantaneamente!
  const session = await getSession();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black font-sans">
      
      {/* ==============================================================================
          NAVBAR (Estilo OTE / Kings League)
          ============================================================================== */}
      <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Logo */}
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="text-3xl font-black tracking-tighter uppercase italic">
                HEZI<span className="text-gray-400">TECH</span>
              </Link>
            </div>

            {/* Links Centrais (Desktop) */}
            <nav className="hidden md:flex space-x-8">
              <Link href="/partidas" className="text-sm font-bold tracking-widest uppercase hover:text-gray-300 transition-colors">Partidas</Link>
              <Link href="/times" className="text-sm font-bold tracking-widest uppercase hover:text-gray-300 transition-colors">Times</Link>
              <Link href="/jogadores" className="text-sm font-bold tracking-widest uppercase hover:text-gray-300 transition-colors">Jogadores</Link>
              <Link href="/social" className="text-sm font-bold tracking-widest uppercase text-yellow-400 hover:text-yellow-300 transition-colors">Ação Social</Link>
            </nav>

            {/* Auth Buttons */}
            <div className="flex items-center space-x-4">
              {session ? (
                <Link 
                  href="/admin" 
                  className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm tracking-wide hover:bg-gray-200 transition-all shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                >
                  {session.role === "SUPER_ADMIN" ? "Painel Admin" : "Meu Perfil"}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="text-sm font-bold tracking-wide hover:text-gray-300 transition-colors hidden sm:block">
                    ENTRAR
                  </Link>
                  <Link 
                    href="/register" 
                    className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm tracking-wide hover:bg-gray-200 transition-all"
                  >
                    CRIAR CONTA
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ==============================================================================
          TICKER DE JOGOS (Estilo FIBA 3x3)
          ============================================================================== */}
      <div className="w-full bg-zinc-900 border-b border-zinc-800 overflow-hidden py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center space-x-6 overflow-x-auto no-scrollbar whitespace-nowrap">
          <div className="flex items-center space-x-2 text-sm font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-red-500 uppercase tracking-wider">Ao Vivo</span>
          </div>
          
          {/* Mock de Partida ao Vivo */}
          <Link href="/partidas/live" className="flex items-center space-x-4 bg-black px-4 py-1 rounded-md border border-zinc-800 hover:border-zinc-600 transition-colors">
            <span className="font-bold text-gray-300">FCX</span>
            <span className="text-xl font-black">21</span>
            <span className="text-gray-600">-</span>
            <span className="text-xl font-black text-gray-500">19</span>
            <span className="font-bold text-gray-500">YNG</span>
          </Link>

          <div className="w-px h-6 bg-zinc-800 mx-2"></div>

          {/* Mocks de Próximos Jogos */}
          <div className="flex items-center space-x-4 px-4 py-1">
            <span className="text-xs font-bold text-gray-500 tracking-widest uppercase">Hoje • 19:00</span>
            <span className="font-bold">LIONS</span>
            <span className="text-gray-600 font-bold">vs</span>
            <span className="font-bold">WOLVES</span>
          </div>
          <div className="flex items-center space-x-4 px-4 py-1">
            <span className="text-xs font-bold text-gray-500 tracking-widest uppercase">Amanhã • 10:00</span>
            <span className="font-bold">STREET</span>
            <span className="text-gray-600 font-bold">vs</span>
            <span className="font-bold">KINGS</span>
          </div>
        </div>
      </div>

      {/* ==============================================================================
          HERO SECTION (Estilo Overtime Elite)
          ============================================================================== */}
      <main>
        <section className="relative h-[80vh] flex items-center justify-center overflow-hidden">
          {/* Placeholder de background (Pode ser substituído por um vídeo ou imagem no futuro) */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-800 via-black to-black opacity-60 z-0"></div>
          
          <div className="relative z-10 text-center px-4 max-w-5xl mx-auto flex flex-col items-center">
            <h1 className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tighter uppercase leading-[0.85] mb-6 drop-shadow-2xl">
              O BASQUETE<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">REINVENTADO</span>
            </h1>
            
            <p className="mt-4 max-w-2xl text-lg md:text-xl text-gray-400 font-medium mb-10">
              A maior liga comunitária do Rio de Janeiro. 1x1, 3x3 e 5x5.
              Estatísticas ao vivo, draft, impacto social e o holofote que você merece.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Link 
                href={session ? "/jogadores" : "/register"} 
                className="bg-white text-black px-8 py-4 rounded-full font-black text-lg tracking-widest uppercase hover:scale-105 transition-transform duration-300"
              >
                {session ? "Ver Ranking" : "Entre para a Liga"}
              </Link>
              <Link 
                href="/social" 
                className="bg-transparent border border-white/20 text-white px-8 py-4 rounded-full font-bold text-lg tracking-widest uppercase hover:bg-white/10 transition-colors duration-300"
              >
                Ação Social
              </Link>
            </div>
          </div>
        </section>

        {/* ==============================================================================
            FEATURES GRID (Resumo da Plataforma)
            ============================================================================== */}
        <section className="py-24 bg-black border-t border-zinc-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              
              <div className="border border-zinc-800 bg-zinc-900/50 p-8 rounded-2xl hover:border-zinc-600 transition-colors">
                <h3 className="text-2xl font-black uppercase tracking-wide mb-4">Play-by-Play Oficial</h3>
                <p className="text-gray-400 leading-relaxed">
                  Esqueça a prancheta de papel. Nosso scorebook digital acompanha cada ponto, rebote e toco em tempo real. P-VAL (Player Value) calculado automaticamente.
                </p>
              </div>

              <div className="border border-zinc-800 bg-zinc-900/50 p-8 rounded-2xl hover:border-yellow-600/50 transition-colors group">
                <h3 className="text-2xl font-black uppercase tracking-wide mb-4 group-hover:text-yellow-500 transition-colors">Impacto Real</h3>
                <p className="text-gray-400 leading-relaxed">
                  Não é só sobre basquete. Nossa plataforma integra campanhas de arrecadação de alimentos e agasalhos direto no sistema, conectando as quadras às comunidades.
                </p>
              </div>

              <div className="border border-zinc-800 bg-zinc-900/50 p-8 rounded-2xl hover:border-zinc-600 transition-colors">
                <h3 className="text-2xl font-black uppercase tracking-wide mb-4">Draft & Free Agency</h3>
                <p className="text-gray-400 leading-relaxed">
                  Monte seu perfil de agente livre, suba seus highlights e seja draftado pelas principais equipes na próxima temporada, ao estilo Kings League.
                </p>
              </div>

            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900 bg-black py-12 text-center text-sm font-bold tracking-widest text-gray-600 uppercase">
        <p>© 2026 HEZI TECH. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}