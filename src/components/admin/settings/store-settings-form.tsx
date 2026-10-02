"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";

import { saveStoreSettingsAction } from "@/app/admin/(panel)/settings/actions";
import {
  describedBy,
  Field,
  FormSection,
} from "@/components/admin/catalog/form-layout";
import {
  SeoFieldHint,
  SeoPreview,
} from "@/components/admin/catalog/seo-preview";
import { FormAlert } from "@/components/admin/form-alert";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import {
  HOME_DEFAULT_DESCRIPTION,
  HOME_DEFAULT_TITLE,
  homeMetaDescription,
  homeSeoTitle,
} from "@/lib/seo/catalog-defaults";
import {
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_MAX,
  SEO_TITLE_RECOMMENDED,
} from "@/lib/validation/catalog";
import {
  COMPANY_NAME_MAX,
  CONTACT_EMAIL_MAX,
  SHIPPING_CARRIER_OPTIONS,
  STORE_NAME_MAX,
  storeSettingsFormSchema,
  VAT_RATE_OPTIONS,
  type StoreSettingsFormValues,
} from "@/lib/validation/store-settings";

type Values = StoreSettingsFormValues;

/**
 * The OWNER's store settings form. Validated in the browser for quick
 * feedback and again on the server (authoritative). Amounts are typed in
 * kronor; the server stores öre.
 */
export function StoreSettingsForm({
  initialValues,
  configured,
  siteUrl,
}: {
  initialValues: Values;
  /** False on a fresh store without a settings row yet. */
  configured: boolean;
  siteUrl: string;
}) {
  const form = useForm<Values, unknown, Values>({
    resolver: zodResolver(storeSettingsFormSchema, undefined, { raw: true }),
    defaultValues: initialValues,
    mode: "onTouched",
  });
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const values = useWatch({ control: form.control });
  const { errors } = form.formState;

  const control = (name: Path<Values>, hint = false) => {
    const id = `installningar-${name}`;
    const error = errors[name]?.message;
    return {
      id,
      error,
      props: {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy(id, { hint, error: Boolean(error) }),
        ...form.register(name),
      },
    };
  };

  const onSubmit = form.handleSubmit(
    (submitted) => {
      setFeedback(null);
      startTransition(async () => {
        const result = await saveStoreSettingsAction(submitted);
        if (result.status === "error") {
          for (const [field, message] of Object.entries(
            result.fieldErrors ?? {},
          )) {
            if (message) {
              form.setError(field as Path<Values>, { type: "server", message });
            }
          }
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        if (result.status === "success" && "values" in result) {
          form.reset(result.values);
          setFeedback({ tone: "success", message: result.message });
        }
      });
    },
    () =>
      setFeedback({
        tone: "error",
        message: "Kontrollera de markerade fälten.",
      }),
  );

  const storeName = control("storeName");
  const contactEmail = control("contactEmail", true);
  const companyName = control("companyName", true);
  const organizationNumber = control("organizationNumber", true);
  const shippingPrice = control("shippingPrice", true);
  const freeShippingThreshold = control("freeShippingThreshold", true);
  const carrier = control("defaultShippingCarrier", true);
  const vatRate = control("vatRate", true);
  const lowStock = control("lowStockThreshold", true);
  const seoTitle = control("defaultSeoTitle", true);
  const seoDescription = control("defaultSeoDescription", true);
  const vatOptions: Array<[string, string]> = Object.entries(VAT_RATE_OPTIONS);
  if (!(initialValues.vatRate in VAT_RATE_OPTIONS)) {
    vatOptions.unshift([
      initialValues.vatRate,
      `${Number(initialValues.vatRate) / 100} % (nuvarande, välj en ny)`,
    ]);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {!configured && (
        <FormAlert tone="error">
          Butiken saknar inställningar, så kassan är stängd. Fyll i och spara
          formuläret för att öppna den.
        </FormAlert>
      )}

      <FormSection id="installningar-butik" title="Butik och kundservice">
        <Field id={storeName.id} label="Butiksnamn" error={storeName.error}>
          <Input {...storeName.props} maxLength={STORE_NAME_MAX} />
        </Field>
        <Field
          id={contactEmail.id}
          label="Kundtjänstens e-post"
          hint="Visas i sidfoten och i varje kundmejl, och är svarsadress för order- och leveransmejl."
          error={contactEmail.error}
        >
          <Input
            {...contactEmail.props}
            type="email"
            autoComplete="off"
            maxLength={CONTACT_EMAIL_MAX}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={companyName.id}
            label="Företagsnamn (valfritt)"
            hint="Visas i sidfoten och i mejlen."
            error={companyName.error}
          >
            <Input {...companyName.props} maxLength={COMPANY_NAME_MAX} />
          </Field>
          <Field
            id={organizationNumber.id}
            label="Organisationsnummer (valfritt)"
            hint="T.ex. 556677-8899."
            error={organizationNumber.error}
          >
            <Input
              {...organizationNumber.props}
              inputMode="numeric"
              maxLength={20}
              autoComplete="off"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        id="installningar-frakt"
        title="Frakt"
        description="Gäller nya kassor direkt. Befintliga beställningar behåller sin frakt."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={shippingPrice.id}
            label="Fraktpris (kr, inkl. moms)"
            hint="0 ger fri frakt på allt."
            error={shippingPrice.error}
          >
            <Input {...shippingPrice.props} inputMode="decimal" />
          </Field>
          <Field
            id={freeShippingThreshold.id}
            label="Fri frakt från (kr, valfritt)"
            hint="Varuvärde inkl. moms. Lämna tomt för att aldrig ge fri frakt."
            error={freeShippingThreshold.error}
          >
            <Input {...freeShippingThreshold.props} inputMode="decimal" />
          </Field>
        </div>
        <Field
          id={carrier.id}
          label="Fraktbolag för nya beställningar"
          hint="Namnet visas i Stripes kassa och i orderbekräftelsen."
          error={carrier.error}
        >
          <Select {...carrier.props}>
            {Object.entries(SHIPPING_CARRIER_OPTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      <FormSection id="installningar-moms-lager" title="Moms och lager">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={vatRate.id}
            label="Momssats"
            hint="Gäller nya beställningar. Tidigare beställningar behåller sin momssats."
            error={vatRate.error}
          >
            <Select {...vatRate.props}>
              {vatOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id={lowStock.id}
            label="Gräns för lågt lager (st)"
            hint="Vid så här få tillgängliga visar butiken ”Få kvar i lager” och admin ”Lågt lager”. 0 stänger av."
            error={lowStock.error}
          >
            <Input {...lowStock.props} inputMode="numeric" />
          </Field>
        </div>
      </FormSection>

      <FormSection
        id="installningar-seo"
        title="Sökmotorer (startsidan)"
        description="Valfritt. Startsidans titel och beskrivning i Google och när länken delas. Lämna tomt för att använda standardtexten; det du skriver här ersätter den. Produkter, kategorier och set har egna fält."
      >
        <Field
          id={seoTitle.id}
          label="SEO-titel (valfri)"
          hint={
            <SeoFieldHint
              whenBlank="Tomt: standardtiteln används. Visas utan tillägg, så ta gärna med butikens namn."
              length={values.defaultSeoTitle?.trim().length ?? 0}
              recommended={SEO_TITLE_RECOMMENDED}
            />
          }
          error={seoTitle.error}
        >
          <Input
            {...seoTitle.props}
            maxLength={SEO_TITLE_MAX}
            placeholder={HOME_DEFAULT_TITLE}
          />
        </Field>
        <Field
          id={seoDescription.id}
          label="Metabeskrivning (valfri)"
          hint={
            <SeoFieldHint
              whenBlank="Tomt: standardbeskrivningen används."
              length={values.defaultSeoDescription?.trim().length ?? 0}
              recommended={SEO_DESCRIPTION_RECOMMENDED}
            />
          }
          error={seoDescription.error}
        >
          <Textarea
            {...seoDescription.props}
            rows={3}
            className="min-h-24"
            maxLength={SEO_DESCRIPTION_MAX}
            placeholder={HOME_DEFAULT_DESCRIPTION}
          />
        </Field>
        <SeoPreview
          title={homeSeoTitle({
            defaultSeoTitle: values.defaultSeoTitle ?? null,
          })}
          description={homeMetaDescription({
            defaultSeoDescription: values.defaultSeoDescription ?? null,
          })}
          url={`${siteUrl}/`}
          absoluteTitle
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Sparar…" : "Spara inställningar"}
        </Button>
        {feedback && (
          <FormAlert tone={feedback.tone} className="flex-1">
            {feedback.message}
          </FormAlert>
        )}
      </div>
    </form>
  );
}
