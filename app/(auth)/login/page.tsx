"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { secureFetch } from "@/lib/utils/secure-fetch";

export default function LoginPage() {
  const router = useRouter();
  
  // Controle de Estado da Tela
  const [step, setStep] = useState<"CREDENTIALS" | "2FA_VERIFY" | "2FA_SETUP">("CREDENTIALS");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Dados do Formulário
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  
  // Dados de Transição (Pre-Auth)
  const [preAuthToken, setPreAuthToken] = useState("");
  const [qrCode, setQrCode] = useState("");

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await secureFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || "Erro ao fazer login.");
      }

      if (data.requiresTwoFactor) {
        setPreAuthToken(data.preAuthToken);
        
        if (data.intent === "setup") {
          setQrCode(data.qrCode);
          setStep("2FA_SETUP");
        } else {
          setStep("2FA_VERIFY");
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const intent = step === "2FA_SETUP" ? "setup" : "verify";
      
      const res = await secureFetch("/api/auth/2fa", {
        method: "POST",
        body: JSON.stringify({ code, preAuthToken, intent }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Código inválido ou expirado.");
      }

      router.push("/");
      router.refresh(); 
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 p-6 sm:p-8">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight uppercase italic">HEZI<span className="text-zinc-500">TECH</span></h1>
          <p className="text-zinc-400 mt-2 text-sm font-medium">Acesso restrito à plataforma</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium text-center">
            {error}
          </div>
        )}

        {/* --- TELA 1: E-MAIL E SENHA --- */}
        {step === "CREDENTIALS" && (
          <form onSubmit={handleLoginSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-semibold text-zinc-300">Senha</label>
                <Link href="/forgot-password" className="text-xs font-medium text-zinc-500 hover:text-white transition-colors">
                  Esqueceu a senha?
                </Link>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black font-black uppercase tracking-wider p-4 rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg mt-6"
            >
              {loading ? "Autenticando..." : "Entrar"}
            </button>

            <p className="text-center text-sm font-medium text-zinc-400 mt-6">
              Ainda não faz parte? <Link href="/register" className="text-white hover:underline">Crie sua conta</Link>
            </p>
          </form>
        )}

        {/* --- TELA 2: CONFIGURAÇÃO OU VALIDAÇÃO DO 2FA --- */}
        {(step === "2FA_SETUP" || step === "2FA_VERIFY") && (
          <form onSubmit={handle2FASubmit} className="space-y-5">
            
            {step === "2FA_SETUP" && (
              <div className="text-center mb-6">
                <div className="bg-zinc-950 text-zinc-300 text-sm p-4 rounded-lg font-medium border border-zinc-800 mb-6">
                  Para sua segurança, configure a Autenticação em 2 Fatores obrigatória. Escaneie o código abaixo no Google Authenticator ou Authy.
                </div>
                {qrCode && <img src={qrCode} alt="QR Code 2FA" className="mx-auto border-4 border-white rounded-xl bg-white shadow-xl" />}
              </div>
            )}

            {step === "2FA_VERIFY" && (
              <div className="text-center mb-6">
                <p className="text-zinc-300 font-bold text-lg">Verificação de Segurança</p>
                <p className="text-sm text-zinc-500 mt-1">Abra seu app autenticador e digite o código atual.</p>
              </div>
            )}

            <div>
              <input
                type="text"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full p-4 bg-zinc-950 border border-zinc-800 rounded-lg text-white text-center text-3xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-white text-black font-black uppercase tracking-wider p-4 rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg mt-4"
            >
              {loading ? "Validando..." : "Confirmar Acesso"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("CREDENTIALS");
                setCode("");
              }}
              className="w-full mt-4 text-sm font-medium text-zinc-500 hover:text-white transition-colors"
            >
              ← Voltar e tentar outro usuário
            </button>
          </form>
        )}

      </div>
    </div>
  );
}