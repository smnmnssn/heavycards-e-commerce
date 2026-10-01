/*
 * Building blocks for email HTML. Email clients (Outlook's Word engine,
 * Gmail's CSS sanitizer) ignore most modern CSS, so the markup is
 * deliberately old-fashioned: nested presentation tables, inline styles,
 * system fonts, no images, no external CSS and no media queries. A single
 * 600 px column that shrinks with the viewport is mobile friendly by itself.
 *
 * Every dynamic value must pass through `escapeHtml`.
 */

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Monochrome brand palette, matching the storefront tokens. */
export const EMAIL_COLORS = {
  ink: "#0a0a0a",
  muted: "#525252",
  rule: "#e5e5e5",
  background: "#f5f5f5",
  surface: "#ffffff",
} as const;

export const EMAIL_FONT = "Arial,Helvetica,sans-serif";

/** Raw HTML produced by these helpers (already escaped). */
export type Html = { readonly html: string };
export const raw = (html: string): Html => ({ html });

const text = (value: string | Html) =>
  typeof value === "string" ? escapeHtml(value) : value.html;

export function heading(value: string): Html {
  return raw(
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:${EMAIL_COLORS.ink}">${escapeHtml(value)}</h1>`,
  );
}

export function subheading(value: string): Html {
  return raw(
    `<h2 style="margin:32px 0 12px;font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_COLORS.ink}">${escapeHtml(value)}</h2>`,
  );
}

export function paragraph(value: string | Html, { muted = false } = {}): Html {
  const color = muted ? EMAIL_COLORS.muted : EMAIL_COLORS.ink;
  return raw(
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${color}">${text(value)}</p>`,
  );
}

/** Lines of text without paragraph spacing (addresses). */
export function lines(values: readonly string[]): Html {
  return raw(
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${EMAIL_COLORS.ink}">${values.map(escapeHtml).join("<br>")}</p>`,
  );
}

export function link(label: string, url: string): Html {
  return raw(
    `<a href="${escapeHtml(url)}" style="color:${EMAIL_COLORS.ink};text-decoration:underline">${escapeHtml(label)}</a>`,
  );
}

/** A black button; bulletproof enough for Outlook (padding on the cell). */
export function button(label: string, url: string): Html {
  return raw(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="background:${EMAIL_COLORS.ink}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 24px;font-family:${EMAIL_FONT};font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`,
  );
}

/** Label/value rows, e.g. order number and date, or price totals. */
export function keyValueTable(
  rows: ReadonlyArray<{ label: string; value: string; strong?: boolean }>,
): Html {
  const body = rows
    .map(({ label, value, strong }) => {
      const weight = strong ? "700" : "400";
      const border = strong ? `border-top:1px solid ${EMAIL_COLORS.ink};` : "";
      return `<tr><td style="${border}padding:6px 0;font-size:15px;line-height:1.4;font-weight:${weight};color:${EMAIL_COLORS.ink}">${escapeHtml(label)}</td><td align="right" style="${border}padding:6px 0;font-size:15px;line-height:1.4;font-weight:${weight};color:${EMAIL_COLORS.ink};white-space:nowrap">${escapeHtml(value)}</td></tr>`;
    })
    .join("");
  return raw(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${body}</table>`,
  );
}

/** Product lines: name with a detail line below, amount on the right. */
export function itemTable(
  items: ReadonlyArray<{ name: string; detail: string; amount?: string }>,
): Html {
  const body = items
    .map(
      ({ name, detail, amount }) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.rule};vertical-align:top"><div style="font-size:15px;line-height:1.4;font-weight:700;color:${EMAIL_COLORS.ink}">${escapeHtml(name)}</div><div style="font-size:14px;line-height:1.4;color:${EMAIL_COLORS.muted}">${escapeHtml(detail)}</div></td>${
          amount === undefined
            ? ""
            : `<td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${EMAIL_COLORS.rule};vertical-align:top;font-size:15px;line-height:1.4;color:${EMAIL_COLORS.ink};white-space:nowrap">${escapeHtml(amount)}</td>`
        }</tr>`,
    )
    .join("");
  return raw(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-top:1px solid ${EMAIL_COLORS.rule}">${body}</table>`,
  );
}

/**
 * The full document: text wordmark header, white content card, muted
 * footer. `preheader` is the inbox preview line (hidden in the body).
 */
export function emailDocument({
  title,
  preheader,
  content,
  footer,
}: {
  title: string;
  preheader: string;
  content: readonly Html[];
  footer: readonly Html[];
}): string {
  const { ink, muted, background, surface } = EMAIL_COLORS;
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:${background};color:${ink};font-family:${EMAIL_FONT};-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${background}">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${background}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${EMAIL_FONT}"><tr><td style="padding:8px 4px 20px;font-size:20px;line-height:1;font-weight:800;letter-spacing:0.2em;color:${ink}">HEAVYCARDS</td></tr><tr><td style="background:${surface};padding:32px 24px;border-top:3px solid ${ink}">${content.map((part) => part.html).join("")}</td></tr><tr><td style="padding:20px 4px;font-size:13px;line-height:1.5;color:${muted}">${footer.map((part) => part.html).join("")}</td></tr></table></td></tr></table></body></html>`;
}
