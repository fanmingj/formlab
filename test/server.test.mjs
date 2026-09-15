import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
test('server exposes only public assets and rejects uploads and traversal', async () => {
  const server = createApp(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base); assert.equal(home.status, 200); assert.ok((await home.text()).includes('FormLab'));
    const js = await fetch(base + '/core.js'); assert.ok(js.headers.get('content-type').includes('javascript'));
    const head = await fetch(base + '/index.html', { method: 'HEAD' }); assert.equal(await head.text(), '');
    for (const path of ['/server.mjs', '/package.json', '/__qa', '/%2e%2e%2fpackage.json', '/..%5cpackage.json']) assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base, { method: 'POST', body: 'no uploads' })).status, 405);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
