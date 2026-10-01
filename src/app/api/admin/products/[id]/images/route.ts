import { auth } from "@/lib/auth/server";
import {
  canManageCatalog,
  ForbiddenError,
  resolveAdminSession,
} from "@/lib/auth/authorization";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { storage } from "@/lib/storage/server";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/validation/product-images";
import { uploadProductImage } from "@/server/admin/catalog/product-images";
import { revalidateCatalog } from "@/server/admin/catalog/revalidate";

/*
 * Product image upload (one file per request, multipart field "file").
 *
 * A route handler rather than a server action, so the request is rejected
 * before its body is read: the origin and the administrator's session are
 * checked first, and the body is read with a hard size limit. Server actions
 * would buffer the whole body under a global size limit instead.
 */

/** Room for multipart boundaries and part headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = PRODUCT_IMAGE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;

const noStore = { "Cache-Control": "no-store" };

const fail = (status: number, message: string) =>
  Response.json({ ok: false, message }, { status, headers: noStore });

/**
 * CSRF defence: the session cookie is SameSite=Lax, and the request must
 * come from our own origin (browsers always send Origin on POST).
 */
function isSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(env.siteUrl).origin;
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const TOO_LARGE = "Filen är för stor. Maxstorleken är 4 MB.";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/admin/products/[id]/images">,
): Promise<Response> {
  if (!isSameOrigin(request)) return fail(403, "Ogiltig begäran.");

  const admin = await resolveAdminSession(auth, request.headers);
  if (!admin) return fail(401, "Du är inte inloggad. Logga in igen.");
  if (!canManageCatalog(admin)) return fail(403, "Behörighet saknas.");

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) return fail(413, TOO_LARGE);
  const body = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!body) return fail(413, TOO_LARGE);

  let file: FormDataEntryValue | null;
  try {
    const form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    file = form.get("file");
  } catch {
    return fail(400, "Ogiltig begäran.");
  }
  if (!(file instanceof File)) return fail(400, "Välj en bildfil.");

  const { id } = await params;
  try {
    const result = await uploadProductImage(db, storage, {
      actorId: admin.id,
      productId: id,
      file: {
        bytes: new Uint8Array(await file.arrayBuffer()),
        type: file.type,
        name: file.name,
      },
    });
    if (!result.ok) {
      const status = {
        NOT_FOUND: 404,
        INVALID_FILE: 422,
        LIMIT: 409,
        STORAGE: 503,
      }[result.error];
      return fail(status, result.message);
    }
    revalidateCatalog(result.slugs);
    return Response.json(
      { ok: true, image: result.image },
      { status: 201, headers: noStore },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(403, "Behörighet saknas.");
    console.error("[admin] product image upload failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(500, "Bilden kunde inte sparas. Försök igen.");
  }
}
