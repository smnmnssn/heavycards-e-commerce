"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  removeProductImageAction,
  reorderProductImagesAction,
  updateProductImageAltAction,
} from "@/app/admin/(panel)/products/actions";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/form";
import { IMAGE_ALT_MAX } from "@/lib/validation/catalog";
import {
  formatBytes,
  precheckProductImage,
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIN_SIDE,
  PRODUCT_IMAGES_PER_PRODUCT_MAX,
} from "@/lib/validation/product-images";

import { FormAlert } from "../form-alert";

export type ManagedImage = {
  id: string;
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

type Feedback = { tone: "success" | "error"; messages: string[] } | null;

/**
 * Upload, alt text, order and removal of a product's images. The first image
 * is the primary image. Uploads go one file at a time to the upload route,
 * which validates the actual file contents on the server.
 */
export function ProductImagesManager({
  productId,
  productName,
  images,
}: {
  productId: string;
  productName: string;
  images: ManagedImage[];
}) {
  const router = useRouter();
  const inputId = useId();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = uploading || pending;
  const remaining = PRODUCT_IMAGES_PER_PRODUCT_MAX - images.length;

  async function upload(files: File[]) {
    setFeedback(null);
    const errors: string[] = [];
    let uploaded = 0;
    setUploading(true);
    try {
      for (const file of files.slice(0, Math.max(0, remaining))) {
        const problem = precheckProductImage(file);
        if (problem) {
          errors.push(problem);
          continue;
        }
        const body = new FormData();
        body.append("file", file);
        try {
          const response = await fetch(
            `/api/admin/products/${productId}/images`,
            { method: "POST", body },
          );
          const data = (await response.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
          } | null;
          if (response.ok && data?.ok) {
            uploaded += 1;
          } else {
            errors.push(
              `${file.name}: ${data?.message ?? "Uppladdningen misslyckades."}`,
            );
          }
        } catch {
          errors.push(`${file.name}: nätverksfel. Försök igen.`);
        }
      }
      if (files.length > remaining) {
        errors.push(
          `Högst ${PRODUCT_IMAGES_PER_PRODUCT_MAX} bilder per produkt; ${files.length - Math.max(0, remaining)} fil(er) laddades inte upp.`,
        );
      }
    } finally {
      setUploading(false);
    }
    if (uploaded > 0) router.refresh();
    setFeedback(
      errors.length > 0
        ? {
            tone: "error",
            messages: [
              ...(uploaded > 0
                ? [`${uploaded} bild(er) uppladdade. Några filer misslyckades:`]
                : []),
              ...errors,
            ],
          }
        : {
            tone: "success",
            messages: [
              uploaded === 1
                ? "Bilden är uppladdad."
                : `${uploaded} bilder är uppladdade.`,
            ],
          },
    );
  }

  function run(action: () => Promise<{ status: string; message?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error" || result.status === "success") {
        setFeedback({
          tone: result.status === "error" ? "error" : "success",
          messages: [result.message ?? ""],
        });
      }
    });
  }

  function move(index: number, offset: -1 | 1) {
    const order = images.map((image) => image.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + offset, 0, moved!);
    run(() => reorderProductImagesAction(productId, order));
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor={inputId}>Ladda upp bilder</Label>
        <input
          id={inputId}
          type="file"
          accept={PRODUCT_IMAGE_ACCEPT}
          multiple
          disabled={busy || remaining <= 0}
          aria-describedby={`${inputId}-hint`}
          className="block w-full cursor-pointer rounded-md border border-dashed border-input bg-surface p-4 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border file:border-foreground file:bg-background file:px-4 file:py-2 file:font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) void upload(files);
          }}
        />
        <FieldMessage id={`${inputId}-hint`}>
          JPEG, PNG eller WebP, högst {formatBytes(PRODUCT_IMAGE_MAX_BYTES)} och
          minst {PRODUCT_IMAGE_MIN_SIDE} px. Bilden roteras rätt och
          kamerauppgifter (t.ex. GPS-position) tas bort. Högst{" "}
          {PRODUCT_IMAGES_PER_PRODUCT_MAX} bilder; den första är huvudbild.
        </FieldMessage>
      </div>

      <div aria-live="polite">
        {uploading && <FormAlert tone="info">Laddar upp…</FormAlert>}
        {feedback && (
          <FormAlert tone={feedback.tone}>
            {feedback.messages.length === 1 ? (
              feedback.messages[0]
            ) : (
              <ul className="grid gap-1">
                {feedback.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </FormAlert>
        )}
      </div>

      {images.length === 0 ? (
        <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Inga bilder ännu. Butiken visar en neutral platshållare tills en bild
          laddas upp.
        </p>
      ) : (
        <ol className="grid gap-4" aria-label="Produktbilder i visningsordning">
          {images.map((image, index) => (
            <li
              key={image.id}
              data-testid="product-image"
              className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-[6rem_minmax(0,1fr)]"
            >
              <div className="relative size-24 overflow-hidden rounded-sm bg-surface">
                <Image
                  src={image.url}
                  alt=""
                  width={image.width}
                  height={image.height}
                  sizes="96px"
                  className="size-full object-contain"
                />
              </div>
              <div className="grid min-w-0 gap-3">
                <p className="text-sm font-semibold">
                  Bild {index + 1}
                  {index === 0 && " · Huvudbild"}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({image.width}×{image.height} px)
                  </span>
                </p>
                <AltTextForm
                  key={`${image.id}:${image.altText ?? ""}`}
                  image={image}
                  index={index}
                  productName={productName}
                  disabled={busy}
                  onSave={(altText) =>
                    run(() =>
                      updateProductImageAltAction(productId, image.id, altText),
                    )
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={busy || index === 0}
                    aria-label={`Flytta bild ${index + 1} uppåt`}
                    onClick={() => move(index, -1)}
                  >
                    Flytta upp
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={busy || index === images.length - 1}
                    aria-label={`Flytta bild ${index + 1} nedåt`}
                    onClick={() => move(index, 1)}
                  >
                    Flytta ner
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 text-destructive"
                    disabled={busy}
                    aria-label={`Ta bort bild ${index + 1}`}
                    onClick={() => {
                      if (window.confirm("Ta bort bilden från produkten?")) {
                        run(() =>
                          removeProductImageAction(productId, image.id),
                        );
                      }
                    }}
                  >
                    Ta bort
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AltTextForm({
  image,
  index,
  productName,
  disabled,
  onSave,
}: {
  image: ManagedImage;
  index: number;
  productName: string;
  disabled: boolean;
  onSave: (altText: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(image.altText ?? "");
  const fallback =
    index === 0 ? productName : `${productName}, bild ${index + 1}`;
  const unchanged = value === (image.altText ?? "");
  // Not a <form>: the manager is rendered inside the product form.
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Alt-text för bild {index + 1}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          value={value}
          maxLength={IMAGE_ALT_MAX}
          placeholder={fallback}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Enter saves the alt text instead of submitting the product form.
            event.preventDefault();
            if (!disabled && !unchanged) onSave(value);
          }}
        />
        <Button
          variant="secondary"
          className="h-11 shrink-0"
          disabled={disabled || unchanged}
          onClick={() => onSave(value)}
        >
          Spara alt-text
        </Button>
      </div>
      <FieldMessage id={`${id}-hint`}>
        Beskriv bilden för den som inte ser den. Tomt fält ger ”{fallback}”.
      </FieldMessage>
    </div>
  );
}
