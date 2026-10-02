"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  submitReviewAction,
  type ReviewFormState,
} from "@/app/(store)/review/[token]/actions";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label, Textarea } from "@/components/ui/form";
import {
  characterCount,
  DEFAULT_REVIEW_DISPLAY_NAME,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_DISPLAY_NAME_MAX,
  REVIEW_TITLE_MAX,
  reviewFieldErrors,
  reviewSubmissionSchema,
  type ReviewFieldErrors,
} from "@/lib/validation/reviews";

import { RatingInput } from "./rating-input";

const initialState: ReviewFormState = { status: "idle" };

/**
 * Review form for one purchased product. The browser checks the input with
 * the server's own schema for immediate Swedish feedback; the server
 * validates again and decides everything else (src/server/reviews/submit.ts).
 */
export function ReviewForm({
  token,
  orderItemId,
  productName,
}: {
  token: string;
  orderItemId: string;
  productName: string;
}) {
  const [state, formAction, pending] = useActionState(
    submitReviewAction,
    initialState,
  );
  const [clientErrors, setClientErrors] = useState<ReviewFieldErrors>({});
  const [bodyLength, setBodyLength] = useState(0);
  const id = useId();
  // Ignores a second click before the pending state has rendered. The
  // server would refuse a duplicate anyway (one review per line).
  const inFlight = useRef(false);
  useEffect(() => {
    inFlight.current = false;
  }, [state]);

  if (state.status === "success") {
    return (
      <p role="status" className="border border-border bg-surface p-5">
        <strong className="font-semibold">Tack för din recension!</strong> Den
        publiceras när vi har granskat den.
        {state.allReviewed &&
          " Du har nu recenserat alla produkter i beställningen."}
      </p>
    );
  }
  if (state.status === "closed") {
    return (
      <p role="status" className="border border-border bg-surface p-5">
        {state.message}
      </p>
    );
  }

  const serverErrors = state.status === "error" ? state.fieldErrors : undefined;
  const errors: ReviewFieldErrors = { ...serverErrors, ...clientErrors };
  const fieldId = (field: string) => `${id}-${field}`;
  const describedBy = (field: keyof ReviewFieldErrors, hint = false) =>
    [
      hint && fieldId(`${field}-hint`),
      errors[field] && fieldId(`${field}-error`),
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  /*
   * With JavaScript the form is submitted from here, inside a transition:
   * unlike a native form action, this does not reset the fields, so a
   * server-side error never wipes what the customer wrote. Without
   * JavaScript the form's `action` posts it normally.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || pending) return;
    const data = new FormData(event.currentTarget);
    const parsed = reviewSubmissionSchema.safeParse({
      orderItemId: data.get("orderItemId"),
      rating: data.get("rating"),
      title: data.get("title"),
      body: data.get("body"),
      displayName: data.get("displayName"),
    });
    if (parsed.success) {
      setClientErrors({});
      inFlight.current = true;
      startTransition(() => formAction(data));
      return;
    }
    const found = reviewFieldErrors(parsed.error);
    setClientErrors(found);
    const first = (["rating", "body", "title", "displayName"] as const).find(
      (field) => found[field],
    );
    if (first === "rating") {
      event.currentTarget
        .querySelector<HTMLInputElement>('input[name="rating"]')
        ?.focus();
    } else if (first) {
      document.getElementById(fieldId(first))?.focus();
    }
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      aria-busy={pending}
      className="grid gap-6"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="orderItemId" value={orderItemId} />

      {state.status === "error" && (
        <p
          role="alert"
          className="border border-destructive p-4 text-sm font-medium text-destructive"
        >
          {state.message}
        </p>
      )}

      <div className="grid gap-2">
        <RatingInput
          name="rating"
          legend={`Ditt betyg för ${productName}`}
          error={errors.rating}
          errorId={fieldId("rating-error")}
        />
        {errors.rating && (
          <FieldMessage tone="error" id={fieldId("rating-error")}>
            {errors.rating}
          </FieldMessage>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={fieldId("body")}>Din recension</Label>
        <Textarea
          id={fieldId("body")}
          name="body"
          required
          minLength={REVIEW_BODY_MIN}
          maxLength={REVIEW_BODY_MAX}
          rows={5}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={describedBy("body", true)}
          onChange={(event) =>
            setBodyLength(characterCount(event.currentTarget.value.trim()))
          }
        />
        <FieldMessage id={fieldId("body-hint")}>
          Minst {REVIEW_BODY_MIN} och högst {REVIEW_BODY_MAX} tecken (
          {bodyLength}/{REVIEW_BODY_MAX}).
        </FieldMessage>
        {errors.body && (
          <FieldMessage tone="error" id={fieldId("body-error")}>
            {errors.body}
          </FieldMessage>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={fieldId("title")}>Rubrik (valfritt)</Label>
        <Input
          id={fieldId("title")}
          name="title"
          maxLength={REVIEW_TITLE_MAX}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={describedBy("title")}
        />
        {errors.title && (
          <FieldMessage tone="error" id={fieldId("title-error")}>
            {errors.title}
          </FieldMessage>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={fieldId("displayName")}>
          Namn som visas (valfritt)
        </Label>
        <Input
          id={fieldId("displayName")}
          name="displayName"
          maxLength={REVIEW_DISPLAY_NAME_MAX}
          autoComplete="off"
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={describedBy("displayName", true)}
        />
        <FieldMessage id={fieldId("displayName-hint")}>
          Visas offentligt med recensionen, till exempel ditt förnamn. Lämnar du
          fältet tomt visas ”{DEFAULT_REVIEW_DISPLAY_NAME}”.
        </FieldMessage>
        {errors.displayName && (
          <FieldMessage tone="error" id={fieldId("displayName-error")}>
            {errors.displayName}
          </FieldMessage>
        )}
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Skickar…" : "Skicka recension"}
        </Button>
      </div>
    </form>
  );
}
