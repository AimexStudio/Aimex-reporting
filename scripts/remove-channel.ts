/**
 * Removes one channel's figures from every month and week of every client's dashboards.
 * Default: lists what would be removed. Add --apply to remove it.
 *
 *   npm run remove:channel -- "All channels"            (list)
 *   npm run remove:channel -- "All channels" --apply    (remove)
 */
import { db } from "./_db";
import type { MonthDoc } from "../src/db/types";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const channel = args.filter((a) => a !== "--apply").join(" ").trim() || "All channels";

async function main() {
  console.log(`${apply ? "Removing" : "Looking for"} “${channel}” in every client's months and weeks${apply ? "" : " (nothing is changed without --apply)"}…\n`);
  let found = 0, emptied = 0;
  for (const client of (await db.collection("clients").get()).docs) {
    const name = (client.data().name as string) ?? client.id;
    for (const dash of (await client.ref.collection("dashboards").get()).docs) {
      for (const col of ["months", "weeks"]) {
        for (const doc of (await dash.ref.collection(col).get()).docs) {
          const m = doc.data() as MonthDoc;
          if (!m.channels?.some((c) => c.channel === channel)) continue;
          found++;
          const rest = m.channels.filter((c) => c.channel !== channel);
          console.log(`  ${name} / ${dash.data().name ?? dash.id} / ${doc.id}: ${rest.length ? `keeps ${rest.map((c) => c.channel).join(", ")}` : "no other channels, so the whole period goes"}`);
          if (!apply) continue;
          if (!rest.length) { await doc.ref.delete(); emptied++; continue; }
          const sectionNotes = { ...(m.sectionNotes ?? {}) }; delete sectionNotes[channel];
          const partial = { ...(m.partial ?? {}) }; delete partial[channel];
          await doc.ref.update({ channels: rest, sectionNotes, partial, updatedAt: Date.now() });
        }
      }
    }
  }
  if (!found) console.log(`  None found. No dashboard has “${channel}”.`);
  else if (apply) console.log(`\n✓ Removed “${channel}” from ${found} period${found === 1 ? "" : "s"}${emptied ? ` (${emptied} left empty and removed)` : ""}.`);
  else console.log(`\n${found} period${found === 1 ? "" : "s"} would change. To remove, run the same command with --apply at the end.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
