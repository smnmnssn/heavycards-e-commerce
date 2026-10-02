import type { MetadataRoute } from "next";

import { env } from "@/lib/env/server";
import { isIndexableDeployment, robotsFor } from "@/lib/seo/indexing";

/** robots.txt (src/lib/seo/indexing.ts); generated once per deployment. */
export default function robots(): MetadataRoute.Robots {
  return robotsFor({
    indexable: isIndexableDeployment(env.vercelEnv),
    siteUrl: env.siteUrl,
  });
}
