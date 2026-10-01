import { escapeHtml } from "./html";
import type { EmailMessage } from "./transport";

/**
 * Minimal templates for admin account emails. Customer order emails live in
 * src/server/email/order-templates.ts.
 */

const stockholmDateTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function layout(paragraphs: string[], action: { label: string; url: string }) {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px">${escapeHtml(text)}</p>`)
    .join("");
  return `<!doctype html><html lang="sv"><body style="margin:0;padding:24px;background:#ffffff;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5"><div style="max-width:560px"><p style="margin:0 0 24px;font-weight:700;letter-spacing:0.08em">HEAVYCARDS</p>${body}<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0;color:#525252;font-size:14px">Fungerar inte knappen? Kopiera länken till webbläsaren:<br>${escapeHtml(action.url)}</p></div></body></html>`;
}

export function invitationEmail({
  to,
  name,
  inviterName,
  url,
  expiresAt,
}: {
  to: string;
  name: string;
  inviterName: string;
  url: string;
  expiresAt: Date;
}): EmailMessage {
  const paragraphs = [
    `Hej ${name}!`,
    `${inviterName} har bjudit in dig som administratör för HeavyCards. Välj ett lösenord för att aktivera kontot.`,
    `Länken kan bara användas en gång och gäller till ${stockholmDateTime.format(expiresAt)}.`,
    "Om du inte väntade dig den här inbjudan kan du ignorera mejlet.",
  ];
  return {
    to,
    subject: "Inbjudan till HeavyCards admin",
    text: `${paragraphs.join("\n\n")}\n\nAktivera kontot: ${url}\n`,
    html: layout(paragraphs, { label: "Aktivera kontot", url }),
  };
}

export function passwordResetEmail({
  to,
  name,
  url,
}: {
  to: string;
  name: string;
  url: string;
}): EmailMessage {
  const paragraphs = [
    `Hej ${name}!`,
    "Vi fick en begäran om att återställa lösenordet till ditt administratörskonto hos HeavyCards.",
    "Länken gäller i en timme och kan bara användas en gång. När lösenordet är bytt loggas alla dina sessioner ut.",
    "Om det inte var du kan du ignorera mejlet. Ditt nuvarande lösenord fortsätter att gälla.",
  ];
  return {
    to,
    subject: "Återställ ditt lösenord – HeavyCards admin",
    text: `${paragraphs.join("\n\n")}\n\nVälj ett nytt lösenord: ${url}\n`,
    html: layout(paragraphs, { label: "Välj nytt lösenord", url }),
  };
}
