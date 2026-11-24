import test from 'node:test';
import assert from 'node:assert/strict';
import { onixusSignInUrl, readOnixusReturn } from '../lib/onixus-signin';

const STATE = '0f8fad5b-d9cb-469f-a165-70867728950e';
function memory() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

test('Continue with Onixus goes to the Onixus client login with a one-time state', () => {
  const storage = memory();
  const url = new URL(onixusSignInUrl('https://workspace.onixus.xyz', storage, () => STATE));
  assert.equal(url.origin, 'https://www.onixus.xyz');
  assert.equal(url.pathname, '/workspace/continue');
  assert.equal(url.searchParams.get('state'), STATE);
  assert.equal(url.searchParams.get('return'), 'https://workspace.onixus.xyz');
  assert.equal(storage.map.size, 1);
});

test('the Onixus return is accepted once, and only with our state', () => {
  const storage = memory();
  onixusSignInUrl('https://workspace.onixus.xyz', storage, () => STATE);
  assert.deepEqual(readOnixusReturn(`#onixus_token=abc&state=${STATE}`, storage), { token: 'abc' });
  // Replaying the same link fails: the state was consumed.
  assert.ok('error' in (readOnixusReturn(`#onixus_token=abc&state=${STATE}`, storage) ?? {}));
});

test('a crafted link cannot sign a visitor into someone else\'s Workspace', () => {
  const storage = memory();
  onixusSignInUrl('https://workspace.onixus.xyz', storage, () => STATE);
  const other = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  assert.ok('error' in (readOnixusReturn(`#onixus_token=attacker&state=${other}`, storage) ?? {}));
  assert.ok('error' in (readOnixusReturn('#onixus_token=attacker', memory()) ?? {}));
});

test('pages without an Onixus return are left alone', () => {
  assert.equal(readOnixusReturn('', memory()), null);
  assert.equal(readOnixusReturn('#type=recovery', memory()), null);
});
