/**
 * TEST ONLY. A tiny file-backed stand-in for the subset of Firestore this app uses,
 * enabled only when FIRESTORE_FAKE_FILE is set. Strict where real Firestore is strict:
 * transactions must read before writing, update() fails on missing documents,
 * Date objects are rejected (the app stores dates as numbers).
 */
import fs from "node:fs";

type Data = Record<string, unknown>;
type Store = Record<string, Data>;

function load(file: string): Store {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}
function save(file: string, s: Store) { fs.writeFileSync(file, JSON.stringify(s)); }
function clean(d: Data): Data {
  const walk = (v: unknown): unknown => {
    if (v instanceof Date) throw new Error("Fake Firestore: Date values not allowed; store milliseconds.");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(d) as Data;
}
const isChildOf = (p: string, col: string) => p.startsWith(col + "/") && !p.slice(col.length + 1).includes("/");

export function fakeFirestore(file: string) {
  class DocSnap {
    constructor(public ref: DocRef, private d: Data | undefined) {}
    get id() { return this.ref.id; }
    get exists() { return this.d !== undefined; }
    data() { return this.d === undefined ? undefined : structuredClone(this.d); }
  }
  class QuerySnap {
    constructor(public docs: DocSnap[]) {}
    get size() { return this.docs.length; }
    get empty() { return this.docs.length === 0; }
  }
  class DocRef {
    constructor(public path: string) {}
    get id() { return this.path.split("/").pop()!; }
    collection(name: string) { return new Query(`${this.path}/${name}`); }
    async get() { return new DocSnap(this, load(file)[this.path]); }
    async set(d: Data) { const s = load(file); s[this.path] = clean(d); save(file, s); }
    async update(d: Data) {
      const s = load(file);
      if (!s[this.path]) throw new Error(`5 NOT_FOUND: No document to update: ${this.path}`);
      s[this.path] = { ...s[this.path], ...clean(d) }; save(file, s);
    }
    async delete() { const s = load(file); delete s[this.path]; save(file, s); }
  }
  class Query {
    constructor(public path: string, private filters: [string, unknown][] = [], private order?: [string, "asc" | "desc"], private max?: number) {}
    doc(id: string = crypto.randomUUID()) { return new DocRef(`${this.path}/${id}`); }
    where(f: string, op: string, v: unknown) {
      if (op !== "==") throw new Error("Fake Firestore supports == only");
      return new Query(this.path, [...this.filters, [f, v]], this.order, this.max);
    }
    orderBy(f: string, dir: "asc" | "desc" = "asc") { return new Query(this.path, this.filters, [f, dir], this.max); }
    limit(n: number) { return new Query(this.path, this.filters, this.order, n); }
    select() { return this; }
    async get() {
      const s = load(file);
      let rows = Object.entries(s).filter(([p]) => isChildOf(p, this.path));
      rows = rows.filter(([, d]) => this.filters.every(([f, v]) => d[f] === v));
      if (this.order) {
        const [f, dir] = this.order;
        rows.sort(([, a], [, b]) => (a[f] as never) < (b[f] as never) ? -1 : (a[f] as never) > (b[f] as never) ? 1 : 0);
        if (dir === "desc") rows.reverse();
      }
      if (this.max != null) rows = rows.slice(0, this.max);
      return new QuerySnap(rows.map(([p, d]) => new DocSnap(new DocRef(p), d)));
    }
  }

  return {
    settings() {},
    collection: (name: string) => new Query(name),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: async (r: DocRef | Query) => {
          if (writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
          return r.get();
        },
        set: (r: DocRef, d: Data) => { writes.push(() => r.set(d)); return tx; },
        create: (r: DocRef, d: Data) => { writes.push(async () => { if ((await r.get()).exists) throw new Error("6 ALREADY_EXISTS"); await r.set(d); }); return tx; },
        update: (r: DocRef, d: Data) => { writes.push(() => r.update(d)); return tx; },
        delete: (r: DocRef) => { writes.push(() => r.delete()); return tx; },
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
    async recursiveDelete(r: DocRef) {
      const s = load(file);
      for (const p of Object.keys(s)) if (p === r.path || p.startsWith(r.path + "/")) delete s[p];
      save(file, s);
    },
  };
}
