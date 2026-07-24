import { createTransport, type Transporter } from "nodemailer";

// Session 15: the first standalone mailer in this codebase. NextAuth's
// EmailProvider (server/trpc/auth.ts) already sends magic-link emails via
// its own internal nodemailer usage against the same EMAIL_SERVER/EMAIL_FROM
// env vars — this is a second, independent call site reusing that same SMTP
// transport for notification email, not a shared code path with NextAuth.
let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = createTransport(process.env.EMAIL_SERVER);
  }
  return transporter;
}

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<void> {
  await getTransporter().sendMail({
    to: params.to,
    from: process.env.EMAIL_FROM,
    subject: params.subject,
    text: params.text,
  });
}
