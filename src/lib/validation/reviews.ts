import { z } from "zod";

/*
 * Review submissions (PROJECT.md §42, §73). Shared by the browser form
 * (immediate Swedish feedback) and the server, which is authoritative.
 *
 * Text is normalized before its length is checked and before it is stored:
 * Unicode NFC, CRLF → LF, invisible formatting characters (zero-width,
 * bidirectional overrides) removed, runs of spaces collapsed, at most one
 * empty line in a row, outer whitespace trimmed. Remaining control
 * characters are refused. Reviews are plain text: nothing is interpreted as
 * HTML or Markdown, and React escapes them when rendering.
 *
 * Lengths count characters (code points), like PostgreSQL varchar.
 */

export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_TITLE_MAX = 100;
export const REVIEW_DISPLAY_NAME_MAX = 40;
/** Raw input above this is refused before any normalization work. */
const RAW_INPUT_MAX = 8000;

/**
 * Public author shown when the customer leaves the name blank. Never
 * derived from the order: the customer's name, email and address are not
 * published (and `customerName` is never split into a first name).
 */
export const DEFAULT_REVIEW_DISPLAY_NAME = "Verifierad kund";

const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

export const characterCount = (value: string) => Array.from(value).length;

export function normalizeReviewText(
  value: string,
  { multiline }: { multiline: boolean },
): string {
  const text = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "");
  if (!multiline) return text.replace(/\s+/g, " ").trim();
  return text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const text = (multiline: boolean) =>
  z
    .string({ error: "Ogiltigt värde." })
    .max(RAW_INPUT_MAX, "Texten är för lång.")
    .transform((value) => normalizeReviewText(value, { multiline }))
    .refine((value) => !CONTROL.test(value), {
      error: "Texten innehåller otillåtna tecken.",
    });

/** Optional single-line text: blank becomes null. */
const optionalLine = (max: number, tooLong: string) =>
  z
    .union([text(false), z.undefined(), z.null()])
    .transform((value) => value ?? "")
    .refine((value) => characterCount(value) <= max, { error: tooLong })
    .transform((value) => (value === "" ? null : value));

export const reviewSubmissionSchema = z.object({
  orderItemId: z.uuid({ error: "Ogiltig produkt." }),
  rating: z.coerce
    .number({ error: "Välj ett betyg mellan 1 och 5 stjärnor." })
    .int("Välj ett betyg mellan 1 och 5 stjärnor.")
    .min(1, "Välj ett betyg mellan 1 och 5 stjärnor.")
    .max(5, "Välj ett betyg mellan 1 och 5 stjärnor."),
  title: optionalLine(
    REVIEW_TITLE_MAX,
    `Rubriken får vara högst ${REVIEW_TITLE_MAX} tecken.`,
  ),
  body: text(true)
    .refine((value) => characterCount(value) >= REVIEW_BODY_MIN, {
      error: `Skriv minst ${REVIEW_BODY_MIN} tecken.`,
    })
    .refine((value) => characterCount(value) <= REVIEW_BODY_MAX, {
      error: `Recensionen får vara högst ${REVIEW_BODY_MAX} tecken.`,
    }),
  displayName: optionalLine(
    REVIEW_DISPLAY_NAME_MAX,
    `Namnet får vara högst ${REVIEW_DISPLAY_NAME_MAX} tecken.`,
  ).refine((value) => value === null || !/@|:\/\/|www\./i.test(value), {
    error: "Ange ett namn, inte en e-post- eller webbadress.",
  }),
});

export type ReviewSubmissionInput = z.input<typeof reviewSubmissionSchema>;
export type ReviewSubmission = z.output<typeof reviewSubmissionSchema>;

export type ReviewFieldErrors = Partial<
  Record<"rating" | "title" | "body" | "displayName" | "orderItemId", string>
>;

/** First message per field, for the form. */
export function reviewFieldErrors(error: z.ZodError): ReviewFieldErrors {
  const errors: ReviewFieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "body") as keyof ReviewFieldErrors;
    errors[field] ??= issue.message;
  }
  return errors;
}
