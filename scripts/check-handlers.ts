import assert from 'node:assert/strict';
import pull from '../api/pull.js';
import funds from '../api/test-funds.js';
import status from '../api/status.js';

async function call(handler: any, method: string, body = {}) {
  let statusCode = 200;
  let data: any;
  const res = { setHeader() {}, status(n: number) { statusCode = n; return this; }, json(x: unknown) { data = x; return this; } };
  await handler({ method, body }, res);
  return { statusCode, data };
}
assert.equal((await call(pull, 'GET')).statusCode, 405);
assert.equal((await call(pull, 'POST', { allowanceId: 'bad' })).statusCode, 400);
assert.equal((await call(funds, 'GET')).statusCode, 405);
assert.equal((await call(funds, 'POST', { address: 'bad' })).statusCode, 400);
assert.equal((await call(status, 'POST')).statusCode, 405);
assert.equal((await call(status, 'GET')).data.network, 'testnet');
console.log('API method and malformed-input checks passed.');
