"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState, useTransition } from "react";
import { useForm, useWatch, type Path, type Resolver } from "react-hook-form";

import {
  createCategoryAction,
  updateCategoryAction,
} from "@/app/admin/(panel)/categories/actions";
import {
  createPokemonSetAction,
  updatePokemonSetAction,
} from "@/app/admin/(panel)/sets/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { categoryPath, setPath } from "@/lib/catalog-paths";
import {
  categoryMetaDescription,
  categorySeoTitle,
  setMetaDescription,
  setSeoTitle,
} from "@/lib/seo/catalog-defaults";
import { slugify } from "@/lib/slug";
import {
  categoryFormSchema,
  pokemonSetFormSchema,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_RECOMMENDED,
  TAXONOMY_SLUG_MAX,
  type CategoryFormValues,
  type FieldErrors,
  type PokemonSetFormValues,
} from "@/lib/validation/catalog";

import { FormAlert } from "../form-alert";
import { CharacterCount, describedBy, Field, FormSection } from "./form-layout";
import { SeoPreview } from "./seo-preview";

type Values = CategoryFormValues & Partial<PokemonSetFormValues>;

type Kind = "category" | "set";

const COPY: Record<
  Kind,
  { create: string; pathFor: (slug: string) => string }
> = {
  category: { create: "Skapa kategori", pathFor: categoryPath },
  set: { create: "Skapa set", pathFor: setPath },
};

/**
 * Create/edit form for a category or a Pokémon set. Both are public landing
 * pages, so the SEO preview is always shown and a slug change on an existing
 * one always keeps the old URL working (permanent redirect).
 */
export function TaxonomyForm({
  kind,
  id,
  initialValues,
  siteUrl,
}: {
  kind: Kind;
  /** Present when editing. */
  id?: string;
  initialValues: CategoryFormValues | PokemonSetFormValues;
  siteUrl: string;
}) {
  const form = useForm<Values, unknown, Values>({
    // Each schema validates exactly the fields its form renders.
    resolver: (kind === "category"
      ? zodResolver(categoryFormSchema, undefined, { raw: true })
      : zodResolver(pokemonSetFormSchema, undefined, {
          raw: true,
        })) as Resolver<Values, unknown, Values>,
    defaultValues: initialValues as Values,
    mode: "onTouched",
  });
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [savedSlug, setSavedSlug] = useState(initialValues.slug);
  const slugEdited = useRef(Boolean(id));
  const values = useWatch({ control: form.control });
  const { errors } = form.formState;
  const copy = COPY[kind];

  const control = (name: Path<Values>, hint = false) => {
    const fieldId = `${kind}-${name}`;
    const error = errors[name as keyof Values]?.message;
    return {
      id: fieldId,
      error,
      props: {
        id: fieldId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy(fieldId, {
          hint,
          error: Boolean(error),
        }),
        ...form.register(name),
      },
    };
  };

  const applyServerErrors = (fieldErrors: FieldErrors | undefined) => {
    for (const [field, message] of Object.entries(fieldErrors ?? {})) {
      form.setError(field as Path<Values>, { type: "server", message });
    }
  };

  const onSubmit = form.handleSubmit(
    (submitted) => {
      setFeedback(null);
      startTransition(async () => {
        if (!id) {
          const result =
            kind === "category"
              ? await createCategoryAction(submitted)
              : await createPokemonSetAction(submitted);
          if (result?.status === "error") {
            applyServerErrors(result.fieldErrors);
            setFeedback({ tone: "error", message: result.message });
          }
          return;
        }
        const result =
          kind === "category"
            ? await updateCategoryAction(id, submitted)
            : await updatePokemonSetAction(id, submitted);
        if (result.status === "error") {
          applyServerErrors(result.fieldErrors);
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        setSavedSlug(result.values.slug);
        form.reset(result.values as Values);
        setFeedback({ tone: "success", message: result.message });
      });
    },
    () =>
      setFeedback({
        tone: "error",
        message: "Kontrollera de markerade fälten.",
      }),
  );

  const name = control("name");
  const slug = control("slug", true);
  const description = control("description", true);
  // Only the field this kind of form renders is registered.
  const kindField =
    kind === "category"
      ? control("sortOrder", true)
      : control("releaseDate", true);
  const seoTitle = control("seoTitle", true);
  const seoDescription = control("seoDescription", true);

  const previewName = values.name?.trim() || "Namn";
  const seoInput = {
    name: previewName,
    seoTitle: values.seoTitle ?? null,
    seoDescription: values.seoDescription ?? null,
    description: values.description ?? null,
  };
  const currentSlug = values.slug?.trim() || "…";
  const slugChanged = Boolean(id) && currentSlug !== savedSlug;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <FormSection id={`${kind}-grund`} title="Grundinformation">
        <Field id={name.id} label="Namn" error={name.error}>
          <Input
            {...name.props}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => {
              void name.props.onChange(event);
              if (!slugEdited.current) {
                form.setValue("slug", slugify(event.target.value, 120));
              }
            }}
          />
        </Field>
        <Field
          id={slug.id}
          label="URL-slug"
          hint={`Adress: ${copy.pathFor(currentSlug)}`}
          error={slug.error}
        >
          <Input
            {...slug.props}
            maxLength={TAXONOMY_SLUG_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              slugEdited.current = true;
              void slug.props.onChange(event);
            }}
          />
        </Field>
        {slugChanged && (
          <FormAlert tone="info">
            Adressen ändras. När du sparar leder{" "}
            <code className="break-all">{copy.pathFor(savedSlug)}</code>{" "}
            permanent till den nya adressen.
          </FormAlert>
        )}
        <Field
          id={description.id}
          label="Beskrivning (valfri)"
          hint="Visas överst på sidan i butiken. Tom rad ger nytt stycke."
          error={description.error}
        >
          <Textarea {...description.props} className="min-h-32" />
        </Field>
        {kind === "category" ? (
          <Field
            id={kindField.id}
            label="Sorteringsordning"
            hint="Lägre tal visas först, t.ex. på startsidan."
            error={kindField.error}
          >
            <Input
              {...kindField.props}
              inputMode="numeric"
              className="max-w-40 tabular-nums"
            />
          </Field>
        ) : (
          <Field
            id={kindField.id}
            label="Släppdatum (valfritt)"
            hint="Setets officiella släppdatum. Set sorteras efter det."
            error={kindField.error}
          >
            <Input {...kindField.props} type="date" className="max-w-60" />
          </Field>
        )}
      </FormSection>

      <FormSection
        id={`${kind}-seo`}
        title="Sökmotorer (SEO)"
        description="Valfritt. Tomma fält ersätts automatiskt."
      >
        <Field
          id={seoTitle.id}
          label="SEO-titel"
          hint={
            <CharacterCount
              length={values.seoTitle?.trim().length ?? 0}
              recommended={SEO_TITLE_RECOMMENDED}
            />
          }
          error={seoTitle.error}
        >
          <Input {...seoTitle.props} maxLength={200} autoComplete="off" />
        </Field>
        <Field
          id={seoDescription.id}
          label="Metabeskrivning"
          hint={
            <CharacterCount
              length={values.seoDescription?.trim().length ?? 0}
              recommended={SEO_DESCRIPTION_RECOMMENDED}
            />
          }
          error={seoDescription.error}
        >
          <Textarea
            {...seoDescription.props}
            maxLength={500}
            className="min-h-24"
          />
        </Field>
        <SeoPreview
          title={
            kind === "category"
              ? categorySeoTitle(seoInput)
              : setSeoTitle(seoInput)
          }
          description={
            kind === "category"
              ? categoryMetaDescription(seoInput)
              : setMetaDescription(seoInput)
          }
          url={`${siteUrl}${copy.pathFor(currentSlug)}`}
        />
      </FormSection>

      <div className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:flex sm:items-center sm:justify-between sm:p-6">
        <div aria-live="polite" className="min-w-0 sm:flex-1">
          {feedback && (
            <FormAlert tone={feedback.tone}>{feedback.message}</FormAlert>
          )}
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Sparar…" : id ? "Spara ändringar" : copy.create}
        </Button>
      </div>
    </form>
  );
}
