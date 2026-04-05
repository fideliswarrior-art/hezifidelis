"use server";

import { z } from "zod";
import { db } from "../db";
import { safeAction } from "../security/wrappers/safe-action";
import { emailSchema, strongPasswordSchema } from "../security/utils/validations";
import { hashPassword } from "../security/auth/password";
import { generateEmailVerificationToken } from "../security/auth/verification";
import { sendVerificationEmail } from "../email/sender";
import { createAuditLog } from "../security/audit/audit.service";
import { AuditEvent } from "../security/audit/audit.events";
import { generatePasswordResetToken } from "../security/auth/verification";
import { sendPasswordResetEmail } from "../email/sender";

// ============================================================================
// 1. AÇÃO DE CADASTRO (SIGN UP)
// ============================================================================

const SignUpSchema = z.object({
  name: z.string().min(2, "O nome deve ter pelo menos 2 caracteres."),
  email: emailSchema,
  password: strongPasswordSchema,
});

export const signUp = async (dados: unknown) => {
  return safeAction({
    schema: SignUpSchema,
    rateLimitBucket: "auth", // Limita spam de criação de contas (5 req/min)        // Bloqueia envios forjados de outros domínios
  }, async (parsedInput) => {
    const { name, email, password } = parsedInput;

    // 1. Verifica se o e-mail já está em uso
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error("Este e-mail já está vinculado a uma conta.");
    }

    // 2. Hash seguro da senha (argon2id - Camada C1)
    const hashedPassword = await hashPassword(password);

    // 3. Cria o usuário com Princípio de Menor Privilégio
    const newUser = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "USER",          // Cargo mais baixo por padrão
        isActive: true,
        emailVerified: false,  // OBRIGATÓRIO: Bloqueia compras/inscrições até validar
      },
    });

    // 4. Gera o token temporário (24h) e dispara o e-mail
    const token = await generateEmailVerificationToken(newUser.email);
    await sendVerificationEmail(newUser.email, token);

    return {
      success: true,
      message: "Conta criada com sucesso! Verifique sua caixa de entrada para ativar o e-mail.",
    };
  }, dados);
};

// ============================================================================
// 2. AÇÃO DE CONFIRMAÇÃO DE E-MAIL
// ============================================================================

const VerifyEmailSchema = z.object({
  token: z.string().min(1, "O token de verificação é obrigatório."),
});

export const verifyEmail = async (dados: unknown) => {
  return safeAction({
    schema: VerifyEmailSchema,
    rateLimitBucket: "auth",
  }, async (parsedInput) => {
    
    // 1. Busca o token no banco
    const verificationToken = await db.verificationToken.findUnique({
      where: { token: parsedInput.token },
    });

    if (!verificationToken) {
      throw new Error("Token inválido ou não encontrado.");
    }

    // 2. Verifica se o prazo de 24h já passou
    if (verificationToken.expires < new Date()) {
      // Opcional: deletar o token expirado aqui para limpar o banco
      await db.verificationToken.delete({ where: { id: verificationToken.id } });
      throw new Error("Este link de verificação expirou. Solicite um novo reenvio.");
    }

    // 3. Busca o usuário dono do e-mail
    const user = await db.user.findUnique({
      where: { email: verificationToken.email },
    });

    if (!user) {
      throw new Error("O usuário vinculado a este token não existe mais.");
    }

    if (user.emailVerified) {
      return { success: true, message: "Este e-mail já estava verificado." };
    }

    // 4. Efetiva a validação (Transaction para garantir integridade)
    await db.$transaction(async (tx) => {
      // Atualiza o usuário
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });

      // Queima o token para que não seja reutilizado
      await tx.verificationToken.delete({
        where: { id: verificationToken.id },
      });
    });

    // 5. Gera o log de auditoria da Camada C12
    await createAuditLog({
      userId: user.id,
      action: AuditEvent.AUTH_VERIFY_EMAIL,
      entity: "User",
      entityId: user.id,
    });

    return {
      success: true,
      message: "E-mail verificado com sucesso! Você já pode utilizar todas as funções da plataforma.",
    };
  }, dados);
};

// ============================================================================
// 3. AÇÃO DE RECUPERAÇÃO DE SENHA (FORGOT PASSWORD)
// ============================================================================

const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

export const forgotPassword = async (dados: unknown) => {
  return safeAction({
    schema: ForgotPasswordSchema,
    rateLimitBucket: "authEmail", // 10 req/15min por e-mail (Prevenção de Spam na caixa de entrada)
  }, async (parsedInput) => {
    const { email } = parsedInput;

    const user = await db.user.findUnique({
      where: { email },
    });

    // Se o usuário existir E estiver ativo, geramos o token e enviamos o e-mail.
    // Se não existir ou estiver desativado, pulamos essa etapa silenciosamente.
    if (user && user.isActive) {
      const token = await generatePasswordResetToken(user.email);
      await sendPasswordResetEmail(user.email, token);
    }

    // Prevenção contra User Enumeration: A resposta é sempre a mesma!
    return {
      success: true,
      message: "Se este e-mail estiver cadastrado em nosso sistema, você receberá um link de recuperação em instantes.",
    };
  }, dados);
};

// ============================================================================
// 4. AÇÃO DE REDEFINIÇÃO DE SENHA (RESET PASSWORD)
// ============================================================================

const ResetPasswordSchema = z.object({
  token: z.string().min(1, "O token é obrigatório."),
  password: strongPasswordSchema,
});

export const resetPassword = async (dados: unknown) => {
  return safeAction({
    schema: ResetPasswordSchema,
    rateLimitBucket: "auth", 
  }, async (parsedInput) => {
    
    // 1. Busca o token no banco de dados
    const resetToken = await db.verificationToken.findUnique({
      where: { token: parsedInput.token },
    });

    if (!resetToken) {
      throw new Error("Token inválido ou não encontrado.");
    }

    // 2. Verifica se o prazo de 15 minutos já expirou
    if (resetToken.expires < new Date()) {
      await db.verificationToken.delete({ where: { id: resetToken.id } });
      throw new Error("Este link de recuperação expirou. Solicite um novo reenvio.");
    }

    // 3. Busca o usuário
    const user = await db.user.findUnique({
      where: { email: resetToken.email },
    });

    if (!user || !user.isActive) {
      throw new Error("Usuário não encontrado ou conta desativada.");
    }

    // 4. Hashea a nova senha
    const hashedPassword = await hashPassword(parsedInput.password);

    // 5. Atualiza o banco, limpa o token e gera a trilha de auditoria em uma Transaction
    await db.$transaction(async (tx) => {
      // Atualiza a senha
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Queima o token
      await tx.verificationToken.delete({
        where: { id: resetToken.id },
      });

      // Loga na Camada C12 da Matriz
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: AuditEvent.AUTH_RESET_PASSWORD,
          entity: "User",
          entityId: user.id,
          metadata: { reason: "Recuperação de senha via e-mail." }
        }
      });
    });

    return {
      success: true,
      message: "Senha redefinida com sucesso! Você já pode fazer login com sua nova credencial.",
    };
  }, dados);
};