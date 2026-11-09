/** Client categories: Developments (property developments) and Spectrum Collection (hospitality). */
export type ClientCategory = "development" | "collection";

export const CATEGORIES: { id: ClientCategory; label: string; hint: string }[] = [
  { id: "development", label: "Developments", hint: "Property developments: unit sales by status" },
  { id: "collection", label: "Spectrum Collection", hint: "Hospitality: room sales on the books" },
];
export const categoryLabel = (c: ClientCategory) => CATEGORIES.find((x) => x.id === c)!.label;

/** A client's category. Clients from before categories existed: 9 on Barrack is Spectrum Collection, the rest Developments. */
export function clientCategory(c: { name: string; category?: ClientCategory | null }): ClientCategory {
  if (c.category === "development" || c.category === "collection") return c.category;
  return /^\s*9\s*on\s*barrack\b/i.test(c.name) ? "collection" : "development";
}
