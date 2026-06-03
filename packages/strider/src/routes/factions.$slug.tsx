import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import FactionDetail from "@/components/FactionDetail/FactionDetail";
import { factionBySlug } from "@/generated/factions";
import styles from "./factions.$slug.module.css";

export const Route = createFileRoute("/factions/$slug")({
  loader: ({ params }) => {
    const faction = factionBySlug(params.slug);
    if (!faction) throw notFound();
    return { faction };
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.faction.name} — The Strider` },
            {
              name: "description",
              content: `Codex entry for ${loaderData.faction.name}`,
            },
          ],
        }
      : {},
  notFoundComponent: () => (
    <main className={styles.root}>Faction not found.</main>
  ),
  component: FactionPage,
});

function FactionPage() {
  const { faction } = Route.useLoaderData();
  return (
    <main className={styles.root}>
      <nav className={styles.nav}>
        <Link to="/" search={{ seen: true }} className={styles.back}>
          <span className={styles.arrow}>←</span> VOX-CHANNEL CLOSE
        </Link>
        <span className={styles.breadcrumb}>
          {"+ BERTH "}
          {String(faction.order).padStart(2, "0")}
          {" · "}
          {faction.name.toUpperCase()}
          {" +"}
        </span>
      </nav>
      <div
        className={styles.card}
        style={{ "--faction-color": faction.color } as React.CSSProperties}
      >
        <span className={styles.cornerTL} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerTR} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerBL} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerBR} aria-hidden="true">
          +
        </span>
        <FactionDetail faction={faction} />
      </div>
    </main>
  );
}
