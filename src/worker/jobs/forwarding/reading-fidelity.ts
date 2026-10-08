import { marked, type Token, type Tokens } from "marked";

function tokens(body: string) {
  const result: Token[] = [];
  marked.walkTokens(marked.lexer(body), (token) => {
    result.push(token);
  });
  return result;
}
function executable(token: Token): token is Tokens.Code {
  if (token.type !== "code") return false;
  if (token.lang && !/^(text|plaintext|markdown|md|mermaid)$/i.test(token.lang))
    return true;
  return /^(?:\s*(?:git|npm|npx|node|python\d*|bash|sh|docker|curl|uv|pip\d*|const|let|var|import|export|function|class|def|from)\s|\s*[A-Z_][A-Z_\d]*=)/m.test(
    token.text,
  );
}
export function preserveReadingSyntax(original: string, translated: string) {
  const source = tokens(original),
    output = tokens(translated);
  let text = translated;
  for (const type of ["code", "codespan"] as const) {
    const before = source.filter((t) => t.type === type),
      after = output.filter((t) => t.type === type);
    if (before.length !== after.length) continue;
    const replacements = new Map<string, string>();
    before.forEach((token, i) => {
      if (type === "codespan" || executable(token))
        replacements.set(after[i].raw, token.raw);
    });
    if (replacements.size) {
      const pattern = new RegExp(
        [...replacements.keys()]
          .sort((a, b) => b.length - a.length)
          .map((raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
        "g",
      );
      text = text.replace(pattern, (raw) => replacements.get(raw)!);
    }
  }
  const restored = tokens(text);
  const urls = (list: Token[]) =>
    list.flatMap((t) =>
      t.type === "link" || t.type === "image" ? [t.href] : [],
    );
  const expected = urls(source),
    actual = urls(restored);
  const missing = [...new Set(expected.filter((url) => !actual.includes(url)))];
  const invented = [
    ...new Set(
      actual.filter(
        (url) => !expected.includes(url) && !original.includes(url),
      ),
    ),
  ];
  const missingCode = source
    .filter(executable)
    .some(
      (token) =>
        !restored.some((t) => t.type === "code" && t.text === token.text),
    );
  const missingIdentifiers = source
    .filter((t): t is Tokens.Codespan => t.type === "codespan")
    .some(
      (token) =>
        !restored.some((t) => t.type === "codespan" && t.text === token.text),
    );
  return {
    text,
    valid:
      missing.length === 0 &&
      invented.length === 0 &&
      !missingCode &&
      !missingIdentifiers,
    missingUrls: missing,
    inventedUrls: invented,
    missingCode,
    missingIdentifiers,
  };
}
