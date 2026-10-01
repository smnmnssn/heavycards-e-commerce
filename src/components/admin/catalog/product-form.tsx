"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";

import {
  createProductAction,
  updateProductAction,
} from "@/app/admin/(panel)/products/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { productPath } from "@/lib/catalog-paths";
import type { IsoDate } from "@/lib/dates";
import {
  productMetaDescription,
  productSeoTitle,
} from "@/lib/seo/catalog-defaults";
import { slugify } from "@/lib/slug";
import {
  PRODUCT_SLUG_MAX,
  productFormSchema,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_RECOMMENDED,
  type FieldErrors,
  type ProductFormValues,
} from "@/lib/validation/catalog";

import { FormAlert } from "../form-alert";
import { CharacterCount, describedBy, Field, FormSection } from "./form-layout";
import {
  PRODUCT_STATUS_HINTS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUSES,
  PRODUCT_TYPE_LABELS,
  PRODUCT_TYPES,
} from "./labels";
import { SeoPreview } from "./seo-preview";

type Option = { id: string; name: string };

type Form = UseFormReturn<ProductFormValues, unknown, ProductFormValues>;

type Feedback = { tone: "success" | "error"; message: string } | null;

export type ProductFormProps = {
  siteUrl: string;
  /** The image manager (edit) or a note (create), shown before SEO. */
  imagesSection: ReactNode;
  today: IsoDate;
  categories: Option[];
  sets: Option[];
  initialValues: ProductFormValues;
} & (
  | { mode: "create" }
  | {
      mode: "edit";
      productId: string;
      /** Stock the form was loaded with (compare-and-set baseline). */
      stockOnHand: number;
      reservedQuantity: number;
      /** The product has been public, so a slug change creates a redirect. */
      wasPublished: boolean;
    }
);

/**
 * Create/edit form for a product. Validation runs in the browser with the
 * shared Zod schema for quick feedback; the server action validates the
 * same values again and is authoritative (its field errors are shown here).
 */
export function ProductForm(props: ProductFormProps) {
  const form: Form = useForm<ProductFormValues, unknown, ProductFormValues>({
    resolver: zodResolver(productFormSchema, undefined, { raw: true }),
    defaultValues: props.initialValues,
    mode: "onTouched",
  });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const [stockBaseline, setStockBaseline] = useState(
    props.mode === "edit" ? props.stockOnHand : 0,
  );
  const [savedSlug, setSavedSlug] = useState(props.initialValues.slug);

  const applyServerErrors = (fieldErrors: FieldErrors | undefined) => {
    for (const [field, message] of Object.entries(fieldErrors ?? {})) {
      if (field in props.initialValues) {
        form.setError(field as keyof ProductFormValues, {
          type: "server",
          message,
        });
      }
    }
  };

  const onSubmit = form.handleSubmit(
    (values) => {
      setFeedback(null);
      startTransition(async () => {
        if (props.mode === "create") {
          // Redirects to the new product's page on success.
          const result = await createProductAction(values);
          if (result?.status === "error") {
            applyServerErrors(result.fieldErrors);
            setFeedback({ tone: "error", message: result.message });
          }
          return;
        }
        const result = await updateProductAction(
          props.productId,
          values,
          stockBaseline,
        );
        if (result.status === "error") {
          applyServerErrors(result.fieldErrors);
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        setStockBaseline(result.stockOnHand);
        setSavedSlug(result.values.slug);
        form.reset(result.values);
        setFeedback({ tone: "success", message: result.message });
      });
    },
    () =>
      setFeedback({
        tone: "error",
        message: "Kontrollera de markerade fälten.",
      }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <BasicSection form={form} {...props} />
      <CommerceSection form={form} {...props} />
      <ReleaseSection form={form} today={props.today} />
      <FormSection
        id="bilder"
        title="Bilder"
        description="Bildändringar sparas direkt, oberoende av knappen Spara ändringar."
      >
        {props.imagesSection}
      </FormSection>
      <SeoSection
        form={form}
        siteUrl={props.siteUrl}
        sets={props.sets}
        savedSlug={savedSlug}
        wasPublished={props.mode === "edit" && props.wasPublished}
      />

      <div className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:flex sm:items-center sm:justify-between sm:p-6">
        <div aria-live="polite" className="min-w-0 sm:flex-1">
          {feedback && (
            <FormAlert tone={feedback.tone}>{feedback.message}</FormAlert>
          )}
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending
            ? "Sparar…"
            : props.mode === "create"
              ? "Skapa produkt"
              : "Spara ändringar"}
        </Button>
      </div>
    </form>
  );
}

/** Registers a field and returns its id, error and accessible attributes. */
function fieldPropsFor(form: Form) {
  const { errors } = form.formState;
  return (name: keyof ProductFormValues, { hint = false } = {}) => {
    const id = `product-${name}`;
    const error = errors[name]?.message;
    return {
      id,
      error,
      control: {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy(id, { hint, error: Boolean(error) }),
        ...form.register(name),
      },
    };
  };
}

function BasicSection({
  form,
  categories,
  sets,
  ...props
}: { form: Form } & ProductFormProps) {
  const field = fieldPropsFor(form);
  const slugEdited = useRef(props.mode === "edit");
  const name = field("name");
  const slug = field("slug", { hint: true });
  const shortDescription = field("shortDescription", { hint: true });
  const description = field("description", { hint: true });
  const productType = field("productType", { hint: true });
  const category = field("categoryId");
  const set = field("pokemonSetId");

  return (
    <FormSection id="grundinformation" title="Grundinformation">
      <Field id={name.id} label="Produktnamn" error={name.error}>
        <Input
          {...name.control}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => {
            void name.control.onChange(event);
            if (!slugEdited.current) {
              form.setValue("slug", slugify(event.target.value), {
                shouldValidate: form.formState.isSubmitted,
              });
            }
          }}
        />
      </Field>
      <Field
        id={slug.id}
        label="URL-slug"
        hint="Del av produktens adress. Små bokstäver, siffror och bindestreck."
        error={slug.error}
      >
        <div className="flex gap-2">
          <Input
            {...slug.control}
            maxLength={PRODUCT_SLUG_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              slugEdited.current = true;
              void slug.control.onChange(event);
            }}
          />
          <Button
            variant="secondary"
            className="h-11 shrink-0"
            onClick={() =>
              form.setValue("slug", slugify(form.getValues("name")), {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            Från namnet
          </Button>
        </div>
      </Field>
      <Field
        id={shortDescription.id}
        label="Kortbeskrivning (valfri)"
        hint="Visas nära priset och används som metabeskrivning om ingen anges. Högst 500 tecken."
        error={shortDescription.error}
      >
        <Textarea
          {...shortDescription.control}
          maxLength={500}
          className="min-h-24"
        />
      </Field>
      <Field
        id={description.id}
        label="Beskrivning (valfri)"
        hint="Längre produkttext. Tom rad ger nytt stycke."
        error={description.error}
      >
        <Textarea {...description.control} className="min-h-48" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field
          id={productType.id}
          label="Produkttyp"
          hint="V1 har inga typspecifika fält."
          error={productType.error}
        >
          <Select {...productType.control}>
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PRODUCT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={category.id} label="Kategori" error={category.error}>
          <Select {...category.control}>
            <option value="">Välj kategori…</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={set.id} label="Pokémon-set" error={set.error}>
          <Select {...set.control}>
            <option value="">Inget set</option>
            {sets.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormSection>
  );
}

function CommerceSection({
  form,
  ...props
}: { form: Form } & ProductFormProps) {
  const field = fieldPropsFor(form);
  const price = field("price", { hint: true });
  const compareAt = field("compareAtPrice", { hint: true });
  const sku = field("sku", { hint: true });
  const stock = field("stockOnHand", { hint: true });
  const isPreorder = useWatch({ control: form.control, name: "isPreorder" });
  const stockValue = useWatch({ control: form.control, name: "stockOnHand" });
  const reserved = props.mode === "edit" ? props.reservedQuantity : 0;
  const parsedStock = /^\d+$/.test(stockValue.trim())
    ? Number(stockValue)
    : null;

  return (
    <FormSection
      id="handel"
      title="Pris och lager"
      description="Priser anges i kronor inklusive moms."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={price.id}
          label="Pris (kr)"
          hint="T.ex. 1499 eller 1499,50."
          error={price.error}
        >
          <Input {...price.control} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field
          id={compareAt.id}
          label="Jämförpris (valfritt, kr)"
          hint="Visas överstruket. Måste vara högre än priset."
          error={compareAt.error}
        >
          <Input
            {...compareAt.control}
            inputMode="decimal"
            autoComplete="off"
          />
        </Field>
        <Field
          id={sku.id}
          label="Artikelnummer (SKU)"
          hint="Unikt. Sparas med versaler."
          error={sku.error}
        >
          <Input
            {...sku.control}
            maxLength={64}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
        <Field
          id={stock.id}
          label="Lagersaldo (st)"
          hint={
            <>
              {isPreorder
                ? "Förbeställningskvot: antal som kan förbeställas."
                : "Fysiskt antal i lager."}
              {props.mode === "edit" && (
                <>
                  {" "}
                  Reserverat i pågående kassor: {reserved} st
                  {parsedStock !== null &&
                    ` · tillgängligt att sälja: ${Math.max(0, parsedStock - reserved)} st`}
                  .
                </>
              )}
            </>
          }
          error={stock.error}
        >
          <Input
            {...stock.control}
            inputMode="numeric"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
      </div>
    </FormSection>
  );
}

function ReleaseSection({ form, today }: { form: Form; today: IsoDate }) {
  const field = fieldPropsFor(form);
  const status = field("status", { hint: true });
  const releaseDate = field("releaseDate", { hint: true });
  const statusValue = useWatch({ control: form.control, name: "status" });
  const isPreorder = useWatch({ control: form.control, name: "isPreorder" });
  const releaseValue = useWatch({ control: form.control, name: "releaseDate" });
  const preorderPastRelease =
    isPreorder && releaseValue !== "" && releaseValue <= today;

  return (
    <FormSection id="publicering" title="Publicering och tillgänglighet">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={status.id}
          label="Status"
          hint={PRODUCT_STATUS_HINTS[statusValue]}
          error={status.error}
        >
          <Select {...status.control}>
            {PRODUCT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PRODUCT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={releaseDate.id}
          label="Släppdatum (valfritt)"
          hint="Visas i butiken. Framtida datum hamnar under Kommande."
          error={releaseDate.error}
        >
          <Input {...releaseDate.control} type="date" />
        </Field>
      </div>
      <fieldset className="grid gap-3">
        <legend className="sr-only">Egenskaper</legend>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <Checkbox {...form.register("isPreorder")} className="mt-0.5" />
          <span>
            <span className="font-semibold">Förbeställning</span>
            <span className="block text-muted-foreground">
              Kan köpas före släpp. Gäller tills du avmarkerar den, även efter
              släppdatumet.
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <Checkbox {...form.register("isFeatured")} className="mt-0.5" />
          <span>
            <span className="font-semibold">Utvald</span>
            <span className="block text-muted-foreground">
              Visas under Utvalda produkter på startsidan.
            </span>
          </span>
        </label>
      </fieldset>
      {preorderPastRelease && (
        <FormAlert tone="info">
          Släppdatumet har passerat men produkten är fortfarande markerad som
          förbeställning. Inget ändras automatiskt – avmarkera förbeställning
          när varorna finns i lager.
        </FormAlert>
      )}
      {statusValue === "ARCHIVED" && (
        <FormAlert tone="info">
          Arkiverade produkter går inte att köpa och visas inte i listor eller
          sök. Ordrar och gamla länkar fortsätter att fungera.
        </FormAlert>
      )}
    </FormSection>
  );
}

function SeoSection({
  form,
  siteUrl,
  sets,
  savedSlug,
  wasPublished,
}: {
  form: Form;
  siteUrl: string;
  sets: Option[];
  savedSlug: string;
  wasPublished: boolean;
}) {
  const field = fieldPropsFor(form);
  const seoTitle = field("seoTitle", { hint: true });
  const seoDescription = field("seoDescription", { hint: true });
  const values = useWatch({ control: form.control });
  const slug = values.slug?.trim() || "…";
  const setName = sets.find((set) => set.id === values.pokemonSetId)?.name;
  const title = productSeoTitle({
    name: values.name?.trim() || "Produktnamn",
    seoTitle: values.seoTitle ?? null,
  });
  const description = productMetaDescription({
    name: values.name?.trim() || "Produktnamn",
    seoDescription: values.seoDescription ?? null,
    shortDescription: values.shortDescription ?? null,
    description: values.description ?? null,
    setName: setName ?? null,
  });
  const slugChanged = wasPublished && slug !== savedSlug && slug !== "…";

  return (
    <FormSection
      id="seo"
      title="Sökmotorer (SEO)"
      description="Valfritt. Tomma fält ersätts automatiskt med namn och beskrivning."
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
        <Input {...seoTitle.control} maxLength={200} autoComplete="off" />
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
          {...seoDescription.control}
          maxLength={500}
          className="min-h-24"
        />
      </Field>
      <SeoPreview
        title={title}
        description={description}
        url={`${siteUrl}${productPath(slug)}`}
      />
      {slugChanged && (
        <FormAlert tone="info">
          Adressen ändras. När du sparar leder den gamla adressen{" "}
          <code className="break-all">{productPath(savedSlug)}</code> permanent
          till den nya, så länkar och sökresultat fortsätter att fungera.
        </FormAlert>
      )}
    </FormSection>
  );
}
