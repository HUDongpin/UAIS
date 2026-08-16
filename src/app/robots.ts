import type { MetadataRoute } from "next";

// Crawl policy for the whole site, which until now had none at all - meaning a
// signed-out `/share/<id>` transcript was as indexable as the home page.
//
// The rule that matters is `/share/`: a share link is a capability handed to
// particular people, and an indexed transcript publishes a classroom
// conversation to anyone who searches a phrase from it. Revoking the link cannot
// take a search result back, so the exclusion has to be there before the first
// crawl rather than after the first incident.
//
// `/api/` follows for a different reason: those routes answer JSON with
// `cache-control: no-store` and exist for the app, not for a reader, so crawling
// them costs the store reads behind them and indexes nothing anyone wants.
//
// Everything else stays crawlable - the course plaza and the marketing surfaces
// are the point of the site being public.
//
// No sitemap is declared: the product has no `sitemap.ts`, and naming one that
// does not exist would only send crawlers to a 404.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/share/", "/api/"],
    },
  };
}
