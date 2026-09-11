import test from 'node:test';
import assert from 'node:assert/strict';
import { codexReadOnlyStore } from '../src/adapters/model.mjs';
const fakeToken = expiry => `fictional.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.fictional`;
test('Codex store exposes access only and never imports refresh credentials', async () => {
  const store = codexReadOnlyStore(async () => ({ tokens: { access_token: fakeToken(3600), refresh_token: 'fictional-refresh-never-shared' } }), () => 0);
  const credential = await store.read('openai-codex');
  assert.equal(credential.refresh, 'managed-by-codex');
  assert.equal(await store.read('openai'), undefined);
  await assert.rejects(store.modify(), { code: 'login_required' });
});
test('expiring or malformed credentials require the owning application to refresh', async () => {
  const store = codexReadOnlyStore(async () => ({ tokens: { access_token: fakeToken(1) } }), () => 0);
  await assert.rejects(store.read('openai-codex'), { code: 'login_required' });
  const missing = codexReadOnlyStore(async () => ({}));
  await assert.rejects(missing.read('openai-codex'), { code: 'login_required' });
});
