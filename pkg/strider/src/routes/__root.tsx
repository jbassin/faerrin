/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import PixiHost from "@/components/PixiHost/PixiHost";
import SiteHeader from "@/components/SiteHeader/SiteHeader";
import { EntitiesObservedProvider } from "@/components/SiteHeader/entitiesObserved";
import { CONTENT_HASH } from "@/generated/contentHash";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@faerrin/gothic/index.css";
import "@/styles/globals.css";

const OG_IMAGE_URL = `https://strider.iridi.cc/og-map.png?id=${CONTENT_HASH}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "The Strider" },
      { name: "description", content: "Faction map of The Strider" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "The Strider" },
      { property: "og:title", content: "The Strider" },
      { property: "og:description", content: "Faction map of The Strider" },
      { property: "og:url", content: "https://strider.iridi.cc/" },
      { property: "og:image", content: OG_IMAGE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The Strider" },
      {
        name: "twitter:description",
        content: "Faction map of The Strider",
      },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <PixiHost>
          <EntitiesObservedProvider>
            <SiteHeader />
            <Outlet />
          </EntitiesObservedProvider>
          <Scripts />
        </PixiHost>
      </body>
    </html>
  );
}
