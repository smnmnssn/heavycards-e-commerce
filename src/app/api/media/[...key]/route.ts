import { contentTypeForKey } from "@/lib/storage/keys";
import { localMediaStore } from "@/lib/storage/server";

/**
 * Serves product images stored by the local storage provider (development
 * and E2E). With any other provider, images are served by the provider and
 * this route answers 404. Keys are validated against the generated key
 * format before any file access, so paths outside the storage directory are
 * unreachable.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/media/[...key]">,
): Promise<Response> {
  const key = (await params).key.join("/");
  const contentType = contentTypeForKey(key);
  const body =
    localMediaStore && contentType ? await localMediaStore.read(key) : null;
  if (!body || !contentType) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": contentType,
      // Keys are unique per upload, so a stored file never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
