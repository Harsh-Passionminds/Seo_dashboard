import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

let transport;

function getTransport() {
  if (!env.smtpConfigured) {
    throw new HttpError(
      503,
      "Invitation email is not configured. Configure SMTP before inviting employees.",
      "EMAIL_NOT_CONFIGURED"
    );
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.smtpSecure,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    });
  }
  return transport;
}

export async function sendInvitationEmail({ email, organizationName, role, token }) {
  const acceptanceEndpoint = `${env.API_BASE_PATH.replace(/\/$/, "")}/auth/invitations/accept`;
  const signInUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/`;
  const text = [
    `You have been invited to join ${organizationName} as a ${role}.`,
    `Sign in with Google using ${email}, then submit the included invitation token to ${acceptanceEndpoint}.`,
    `Invitation token: ${token}`,
    `Sign in: ${signInUrl}`,
    "This token is single-use and expires according to the organization's invitation policy."
  ].join("\n\n");
  await getTransport().sendMail({
    from: env.INVITATION_FROM_EMAIL,
    to: email,
    subject: `Invitation to join ${organizationName}`,
    text
  });
}
