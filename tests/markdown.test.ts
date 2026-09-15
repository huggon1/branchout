import test from "node:test";
import assert from "node:assert/strict";
import { resourceUrl } from "../src/ui/Markdown.js";
test("README resources resolve nested, repository-root and parent paths while rejecting unsafe schemes", () => {
  const base =
    "https://raw.githubusercontent.com/example/demo/abc/docs/README.md";
  assert.equal(
    resourceUrl("./图.png", base),
    "https://raw.githubusercontent.com/example/demo/abc/docs/%E5%9B%BE.png",
  );
  assert.equal(
    resourceUrl("/logo.svg", base),
    "https://raw.githubusercontent.com/example/demo/abc/logo.svg",
  );
  assert.equal(
    resourceUrl("../logo.svg", base),
    "https://raw.githubusercontent.com/example/demo/abc/logo.svg",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://127.0.0.1/private",
    "https://name:password@example.com",
    "https://service.local/image",
  ])
    assert.equal(resourceUrl(value, base), "");
  assert.equal(resourceUrl("#usage", base), "#usage");
});
