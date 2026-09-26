import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getEnv().NEXTAUTH_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/banned", "/auth/", "/api/", "/dev/", "/moy-prokat"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
