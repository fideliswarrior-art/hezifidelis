"use client";

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "../../../lib/actions/auth";

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const router = useRouter();
  const resolvedParams = use(searchParams);
  const token = resolvedParams.token;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState(""); 
  
  const [status, setStatus] = useState<"IDLE" | "LOADING" | "SUCCESS" | "ERROR">("IDLE");
  const [errorMessage, setErrorMessage] = useState("");

  const criteria = {
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const isPasswordStrong = Object.values(criteria).every(Boolean);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  // Tela de Erro: Token ausente ou quebrado
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-4">
        <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border-t-4 border-t-red-500 border-x border-b border-zinc-800 p-6 sm:p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Acesso Inválido</h2>
          <p className="text-zinc-400 mb-8 text-sm">O link de recuperação está incompleto ou expirado. Por favor, solicite um novo link.</p>
          <Link href="/forgot-password" className="block w-full bg-white text-black px-6 py-3 rounded-lg font-bold uppercase tracking-wide hover:bg-zinc-200 transition-all">
            Solicitar Novo Link
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("LOADING");
    setErrorMessage("");

    try {
      const result = await resetPassword({ token, password, twoFactorCode });

      if (result.success) {
        setStatus("SUCCESS");
        setTimeout(() => router.push("/login"), 3000);
      } else {
        setStatus("ERROR");
        setErrorMessage(result.error || "Ocorreu um erro ao redefinir a senha.");
      }
    } catch (err) {
      setStatus("ERROR");
      setErrorMessage("Erro de comunicação com o servidor.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 p-6 sm:p-8">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight uppercase italic">
            Nova <span className="text-zinc-500">Senha</span>
          </h1>
          <p className="text-zinc-400 mt-2 text-sm font-medium">Sua conta está protegida por 2FA.</p>
        </div>

        {status === "SUCCESS" ? (
          <div className="text-center py-4">
            <div className="mx-auto w-16 h-16 bg-green-900/30 text-green-400 rounded-full flex items-center justify-center mb-6 border border-green-500/20">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="text-white font-bold text-lg mb-2">Senha Alterada!</p>
            <p className="text-zinc-400 text-sm mb-8">Sua senha foi redefinida com sucesso. Redirecionando para o login...</p>
            <Link href="/login" className="block w-full bg-white text-black px-6 py-3 rounded-lg font-bold uppercase tracking-wide hover:bg-zinc-200 transition-all shadow-md">
              Fazer Login Agora
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {status === "ERROR" && (
              <div className="p-4 bg-red-900/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium text-center">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Nova Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                placeholder="••••••••"
              />

              {/* Indicador de Força de Senha */}
              <div className="mt-3 bg-zinc-950 p-4 rounded-lg border border-zinc-800/50">
                <p className="text-xs font-bold text-zinc-500 mb-3 uppercase tracking-wider">Requisitos</p>
                <ul className="text-xs space-y-2 font-medium">
                  <li className={`flex items-center gap-2 ${criteria.length ? "text-green-400" : "text-zinc-500"}`}>
                    {criteria.length ? "✓" : "○"} Mínimo de 10 caracteres
                  </li>
                  <li className={`flex items-center gap-2 ${criteria.uppercase ? "text-green-400" : "text-zinc-500"}`}>
                    {criteria.uppercase ? "✓" : "○"} Uma letra maiúscula
                  </li>
                  <li className={`flex items-center gap-2 ${criteria.lowercase ? "text-green-400" : "text-zinc-500"}`}>
                    {criteria.lowercase ? "✓" : "○"} Uma letra minúscula
                  </li>
                  <li className={`flex items-center gap-2 ${criteria.number ? "text-green-400" : "text-zinc-500"}`}>
                    {criteria.number ? "✓" : "○"} Um número
                  </li>
                  <li className={`flex items-center gap-2 ${criteria.special ? "text-green-400" : "text-zinc-500"}`}>
                    {criteria.special ? "✓" : "○"} Símbolo (!@#$...)
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Confirme a Senha</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full p-3 bg-zinc-950 border rounded-lg text-white placeholder-zinc-600 transition-all outline-none ${
                  confirmPassword.length > 0 && !passwordsMatch 
                    ? "border-red-500/50 focus:ring-2 focus:ring-red-500" 
                    : "border-zinc-800 focus:ring-2 focus:ring-white focus:border-transparent"
                }`}
                placeholder="••••••••"
              />
            </div>

            <div className="pt-4 pb-4 border-t border-b border-zinc-800 mt-2">
              <label className="block text-sm font-semibold text-zinc-300 mb-3 text-center">
                Código do App Autenticador (2FA)
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-white focus:border-transparent outline-none transition-all"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={status === "LOADING" || !isPasswordStrong || !passwordsMatch || twoFactorCode.length !== 6}
              className="w-full bg-white text-black font-black uppercase tracking-wider p-4 rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg mt-6"
            >
              {status === "LOADING" ? "Redefinindo..." : "Salvar e Continuar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}