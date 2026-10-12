/**
 * Turns a PDF's text layer into tab-separated lines (one per row of text), so table
 * cells such as "6 077" stay separate. Runs on the server only.
 */
import { getDocumentProxy } from "unpdf";
import { PDF_TEXT_MARK } from "./property24";

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  let out = PDF_TEXT_MARK;
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const lines = new Map<number, [number, string][]>();
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      const row = lines.get(y) ?? [];
      row.push([it.transform[4], it.str.trim()]);
      lines.set(y, row);
    }
    out += [...lines].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join("\t")).join("\n") + "\n";
  }
  return out;
}
