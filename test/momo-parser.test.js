import { test } from 'node:test';
import assert from 'node:assert/strict';
import momoParser from '../src/lib/momo-sms-billing/parser.cjs';

const { parseMomoSms, reasonMentionsReference } = momoParser;

// --- parseMomoSms: MTN "received" format (with phone) ---
test('parses a real MTN received SMS with phone number', () => {
  const sms =
    'You have received UGX 11000 from Airtel Money on 2026-08-21 12:06:14. ' +
    'fee:0. Reason: FARIDAH KYALISIIMA , 0743071148. New balance: UGX 11155. ID: 42919920590.';

  const result = parseMomoSms(sms, 'mtn');

  assert.ok(result, 'expected a parsed result');
  assert.equal(result.amountUgx, 11000);
  assert.equal(result.reasonName, 'FARIDAH KYALISIIMA');
  assert.equal(result.reasonPhone, '0743071148');
  assert.equal(result.transactionId, '42919920590');
});

// --- parseMomoSms: MTN "received" format, no phone in Reason field ---
test('parses MTN received SMS with no phone number in Reason', () => {
  const sms =
    'You have received UGX 5000 from MTN Money on 2026-08-20 09:00:00. ' +
    'fee:0. Reason: JOHN OKELLO. New balance: UGX 20000. ID: 12345.';

  const result = parseMomoSms(sms, 'mtn');

  assert.ok(result);
  assert.equal(result.amountUgx, 5000);
  assert.equal(result.reasonName, 'JOHN OKELLO');
  assert.equal(result.reasonPhone, null);
  assert.equal(result.transactionId, '12345');
});

// --- parseMomoSms: Airtel cash deposit format ---
test('parses a real Airtel cash deposit SMS', () => {
  const sms =
    'Cash deposit of UGX 2,000 from sawan distributor 2. Balance UGX 2,000. ' +
    'Trans ID: 154090078762. Date 16-August-2026 12:10.';

  const result = parseMomoSms(sms, 'airtel');

  assert.ok(result);
  assert.equal(result.amountUgx, 2000);
  assert.equal(result.reasonName, 'sawan distributor 2');
  assert.equal(result.reasonPhone, null);
  assert.equal(result.transactionId, '154090078762');
});

// --- parseMomoSms: amounts with thousand separators ---
test('strips comma thousand-separators from amounts', () => {
  const sms =
    'Cash deposit of UGX 150,000 from big shop ltd. Balance UGX 500,000. ' +
    'Trans ID: 999888777. Date 01-Sept-2026 10:00.';

  const result = parseMomoSms(sms, 'airtel');

  assert.ok(result);
  assert.equal(result.amountUgx, 150000);
});

// --- parseMomoSms: unrecognized format returns null, never throws ---
test('returns null (not a throw) for unrecognized SMS text', () => {
  const result = parseMomoSms('Your OTP code is 483920. Do not share it.', 'mtn');
  assert.equal(result, null);
});

test('returns null for empty string', () => {
  assert.equal(parseMomoSms('', 'mtn'), null);
});

// --- reasonMentionsReference: substring matching above the length threshold ---
test('matches when the reference is a substring of a longer payer name', () => {
  assert.equal(reasonMentionsReference('John Okello', 'Okello'), true);
});

test('matches when payer name is a substring of a longer reference', () => {
  assert.equal(reasonMentionsReference('Kampala', 'Kampala Traders Ltd'), true);
});

test('is case- and punctuation-insensitive', () => {
  assert.equal(reasonMentionsReference('Cisdatabun', 'CISDATABUN .'), true);
});

// --- reasonMentionsReference: the short-string guard is the important edge case ---
test('does NOT substring-match below the length threshold (avoids false positives)', () => {
  // "Jo" is short enough that it would otherwise match inside "John Okello"
  // by pure substring containment — the guard requires an exact match instead.
  assert.equal(reasonMentionsReference('John Okello', 'Jo'), false);
});

test('exact match still works below the length threshold', () => {
  assert.equal(reasonMentionsReference('Jo', 'Jo'), true);
});

test('returns false for empty reference text', () => {
  assert.equal(reasonMentionsReference('John Okello', ''), false);
});

test('does not match unrelated names of normal length', () => {
  assert.equal(reasonMentionsReference('Faridah Kyalisiima', 'Peter Mukasa'), false);
});
