import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "../../../../lib/db";
import { safeRoute } from "../../../../lib/security/wrappers/safe-route";
import { hashPassword } from "../../../../lib/security/auth/password";
import { generateEmailVerificationToken } from "../../../../lib/security/auth/verification";
import { sendVerificationEmail, sendAccountExistsEmail } from "../../../../lib/email/sender";
import { emailSchema, strongPasswordSchema } from "../../../../lib/security/utils/validations"; 

const RegisterSchema = z.object({
  name: z.string().min(2, "O nome deve ter pelo menos 2 caracteres."),
  email: emailSchema,
  password: strongPasswordSchema,
});

const registerHandler = async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const { name, email, password } = RegisterSchema.parse(body);

  // 1. Verifica se o e-mail já existe
  const existingUser = await db.user.findUnique({
    where: { email },
  });

  // Fluxo A: Usuário já existe
  if (existingUser) {
    // Ação Silenciosa: Dispara o e-mail de "Conta Existente" e ignora a criação.
    await sendAccountExistsEmail(existingUser.email);
  } 
  // Fluxo B: Novo usuário legítimo
  else {
    const hashedPassword = await hashPassword(password);

    const newUser = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "USER", 
        isActive: true,
        emailVerified: false,
        isTwoFactorEnabled: false,
      },
    });

    const token = await generateEmailVerificationToken(newUser.email);
    await sendVerificationEmail(newUser.email, token);
  }

  // PREVENÇÃO CONTRA USER ENUMERATION:
  // A resposta é idêntica, independente de a conta existir ou não, e usamos o status 200 (OK) 
  // em vez de 201 (Created) para não afirmar que algo novo foi gerado.
  return NextResponse.json(
    { 
      success: true, 
      message: "Processo concluído. Se os dados forem válidos, você receberá um e-mail em instantes para acessar sua conta." 
    },
    { status: 200 } 
  );
};

export const POST = safeRoute(registerHandler, { rateLimitBucket: "auth", checkCsrf: true });