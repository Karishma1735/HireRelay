import test from 'node:test'
import assert from 'node:assert/strict'
import { mapSubmission } from '../src/lib/mapper.js'
import { normPhone, normEmail } from '../src/lib/normalize.js'

test('maps Google Form question titles by meaning', () => {
  const { columns, extra, externalRef } = mapSubmission({
    responseId: 'r1', createTime: 'x', 'Full_Name': 'Asha Rao', 'Email_address': ' ASHA@Example.com ', 'Mobile_number': '+91 98765-43210',
    'Position_applying_for': 'Support Executive', 'Total_years_of_experience': '3.5 years', 'Current_Company': 'Acme', 'Username_on_portal': 'ignore-me'
  })
  assert.equal(columns.full_name, 'Asha Rao')
  assert.equal(columns.email_norm, 'asha@example.com')
  assert.equal(columns.phone_norm, '9876543210')
  assert.equal(columns.role_applied, 'Support Executive')
  assert.equal(columns.experience_years, 3.5)
  assert.equal(columns.current_company, 'Acme')
  assert.equal(externalRef, 'r1')
  assert.equal(extra.responseId, undefined)
  assert.equal(extra.Mobile_number, '+91 98765-43210')
})
test('drive field_map overrides heuristics', () => {
  const { columns } = mapSubmission({ 'Who are you?': 'Ravi', Name: 'Wrong' }, { full_name: 'Who are you?' })
  assert.equal(columns.full_name, 'Ravi')
})
test('normalisers', () => {
  assert.equal(normPhone('09876543210'), normPhone('+91 98765 43210'))
  assert.equal(normEmail('nope'), null)
})
