import { realpath, readFile, lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Lexer } from "marked";

export type DocumentLinkResult = {
  target: string;
  status:
    | "valid"
    | "missing"
    | "missing_anchor"
    | "external"
    | "outside_scope"
    | "unreadable";
};
const within = (root: string, path: string) => {
  const local = relative(root, path);
  return (
    local !== ".." &&
    !local.startsWith(`..${sep}`) &&
    !isAbsolute(local) &&
    !local
      .split(sep)
      .some((x) => x === ".git" || x === "node_modules" || x.startsWith(".env"))
  );
};
export async function inspectLocalDocumentLinks(
  root: string,
  file: string,
  text: string,
): Promise<DocumentLinkResult[]> {
  const canonicalRoot = await realpath(root);
  const source = resolve(canonicalRoot, file);
  if (!within(canonicalRoot, source))
    throw new Error("Document outside repository");
  const targets: string[] = [];
  const collect = (tokens: any[]) => {
    for (const token of tokens) {
      if (
        (token.type === "link" || token.type === "image") &&
        typeof token.href === "string"
      )
        targets.push(token.href);
      if (token.tokens) collect(token.tokens);
      if (token.items) collect(token.items);
      if (token.header)
        for (const cell of token.header) if (cell.tokens) collect(cell.tokens);
      if (token.rows)
        for (const row of token.rows)
          for (const cell of row) if (cell.tokens) collect(cell.tokens);
    }
  };
  collect(Lexer.lex(text));
  const results: DocumentLinkResult[] = [];
  for (const target of [...new Set(targets)].slice(0, 200)) {
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) {
      results.push({ target, status: "external" });
      continue;
    }
    let pathPart: string, anchor: string;
    try {
      const parts = target.split("#");
      pathPart = decodeURIComponent(parts[0].split("?")[0]);
      anchor = decodeURIComponent(parts[1] ?? "");
    } catch {
      results.push({ target, status: "unreadable" });
      continue;
    }
    const path = pathPart ? resolve(dirname(source), pathPart) : source;
    if (!within(canonicalRoot, path)) {
      results.push({ target, status: "outside_scope" });
      continue;
    }
    let canonical: string;
    try {
      // Resolve the nearest existing parent so missing files behind external symlinks
      // remain outside scope rather than appearing as ordinary missing targets.
      let parent = path;
      while (true) {
        try {
          const resolved = await realpath(parent);
          if (!within(canonicalRoot, resolved)) throw new Error("outside");
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const next = dirname(parent);
          if (next === parent) throw error;
          parent = next;
        }
      }
      canonical = await realpath(path);
      if (!within(canonicalRoot, canonical)) throw new Error("outside");
    } catch (error) {
      results.push({
        target,
        status:
          error instanceof Error && error.message === "outside"
            ? "outside_scope"
            : (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "missing"
              : "unreadable",
      });
      continue;
    }
    try {
      if (anchor && /\.mdx?$/i.test(canonical)) {
        const stat = await lstat(canonical);
        if (stat.size > 200_000) throw new Error("large");
        const contents =
          canonical === source ? text : await readFile(canonical, "utf8");
        const seen = new Map<string, number>();
        const ids = Lexer.lex(contents).flatMap((token) => {
          if (token.type !== "heading") return [];
          const base = token.text
            .toLowerCase()
            .replace(/<[^>]*>/g, "")
            .replace(/[^\p{L}\p{N}_\- ]/gu, "")
            .replace(/ /g, "-");
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          return n ? `${base}-${n}` : base;
        });
        results.push({
          target,
          status: ids.includes(anchor) ? "valid" : "missing_anchor",
        });
      } else results.push({ target, status: "valid" });
    } catch {
      results.push({ target, status: "unreadable" });
    }
  }
  return results;
}
