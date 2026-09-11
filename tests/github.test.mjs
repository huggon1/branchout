import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTrending, selectMaterials } from '../src/adapters/github.mjs';
const html = readFileSync(new URL('./fixtures/trending.html', import.meta.url), 'utf8');
test('Trending preserves rank, separates period signal, and excludes external identities', () => {
  const rows = parseTrending(html, 'daily');
  assert.equal(rows.length, 2); assert.equal(rows[0].metrics.stars, 1234);
  assert.equal(rows[0].metrics.forks, 0); assert.equal(rows[0].metrics.periodStars, 42);
  assert.equal(rows[1].metrics.stars, null); assert.equal(rows[1].publishedAt, null);
  assert.equal(rows[1].context.rank, 2); assert.equal(rows[0].completeness, 'partial');
});
test('a changed or login page is a failure, not no results', () => {
  assert.throws(() => parseTrending('<html>Sign in</html>', 'weekly'), { code: 'source_changed' });
});
test('a threshold excludes unknown values and never fills the requested count', () => {
  const rows = parseTrending(html, 'daily');
  assert.equal(selectMaterials(rows, { limit: 20, thresholds: { stars: 0 } }).length, 1);
  assert.equal(selectMaterials(rows, { limit: 20, thresholds: { stars: 2000 } }).length, 0);
  assert.throws(() => selectMaterials(rows, { limit: 20, thresholds: { invented: 0 } }), { code: 'invalid_config' });
});
