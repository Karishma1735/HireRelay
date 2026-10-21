import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import './helpers.js'
import { embedToken, isConfigured, missingConfig } from '../src/lib/viasocket.js'

test('embed token matches the viaSocket contract: HS256, org/project/unique_identifier, no exp', () => {
  assert.equal(isConfigured(), false); assert.ok(missingConfig().includes('VIASOCKET_EMBED_SECRET'))
  assert.throws(() => embedToken('u1'), /not configured/)
  process.env.VIASOCKET_EMBED_SECRET = 'unit-test-secret'
  try {
    const token = embedToken('user-123')
    // Reference signer copied from the skill's "While building" snippet.
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const h = b({ alg: 'HS256', typ: 'JWT' }); const p = b({ org_id: '80251', project_id: 'proj1pVRqxu9', unique_identifier: 'user-123' })
    const sig = crypto.createHmac('sha256', 'unit-test-secret').update(`${h}.${p}`).digest('base64url')
    assert.equal(token, `${h}.${p}.${sig}`)
    assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp, undefined)
  } finally { delete process.env.VIASOCKET_EMBED_SECRET }
})
