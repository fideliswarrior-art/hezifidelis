import nodemailer from "nodemailer";

// O Nodemailer usará as variáveis de ambiente do seu .env
// (Você pode criar uma conta gratuita no Mailtrap.io para testar isso em desenvolvimento)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// A URL base do seu frontend (ex: http://localhost:3000 em dev, https://hezifidelis.com.br em prod)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const EMAIL_FROM = process.env.EMAIL_FROM || '"Hezi Tech" <noreply@hezifidelis.com.br>';

/**
 * Envia o link de confirmação de e-mail logo após o cadastro.
 */
export async function sendVerificationEmail(email: string, token: string) {
  const confirmLink = `${APP_URL}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: "Bem-vindo à Hezi Fidelis! Confirme seu e-mail",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Confirme seu e-mail</h2>
        <p>Clique no link abaixo para ativar sua conta na plataforma Hezi Fidelis:</p>
        <p>
          <a href="${confirmLink}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Confirmar meu e-mail
          </a>
        </p>
        <p style="font-size: 12px; color: #666;">Esse link expira em 24 horas.</p>
      </div>
    `,
  });
}

/**
 * Envia o link de recuperação de senha.
 */
export async function sendPasswordResetEmail(email: string, token: string) {
  const resetLink = `${APP_URL}/auth/reset-password?token=${token}`;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: "Hezi Fidelis - Recuperação de Senha",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Recuperação de Senha</h2>
        <p>Você solicitou a redefinição da sua senha. Clique no botão abaixo para criar uma nova:</p>
        <p>
          <a href="${resetLink}" style="background-color: #E53935; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Redefinir Senha
          </a>
        </p>
        <p style="font-size: 12px; color: #666;">Esse link é válido por apenas 15 minutos por motivos de segurança.</p>
      </div>
    `,
  });
}

/**
 * Envia um e-mail de aviso quando alguém tenta cadastrar um e-mail que já existe no banco.
 * Fundamental para prevenir Enumeração de Usuários sem destruir a experiência do usuário legítimo.
 */
export async function sendAccountExistsEmail(email: string) {
  const loginLink = `${APP_URL}/auth/login`;
  const resetLink = `${APP_URL}/auth/forgot-password`;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: "Aviso de Segurança - Conta já existente na Hezi Fidelis",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Aviso de Segurança</h2>
        <p>Recebemos uma solicitação para criar uma nova conta com este endereço de e-mail na plataforma Hezi Fidelis.</p>
        <p><strong>Porém, este e-mail já está cadastrado em nosso sistema.</strong></p>
        <p>Se foi você, não é necessário criar uma conta nova. Você pode simplesmente fazer o login:</p>
        <p>
          <a href="${loginLink}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">
            Fazer Login
          </a>
        </p>
        <p style="margin-top: 20px;">Esqueceu sua senha? <a href="${resetLink}">Clique aqui para recuperar</a>.</p>
        <p style="font-size: 12px; color: #666; margin-top: 30px;">Se você não solicitou este cadastro, pode ignorar este e-mail tranquilamente. Sua conta está segura.</p>
      </div>
    `,
  });
}