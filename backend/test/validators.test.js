import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl } from '../src/validators.js';

describe('normalizeUrl', () => {
  test('accepts a plain https URL', () => {
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
  });

  test('accepts http as well as https', () => {
    assert.equal(normalizeUrl('http://example.com'), 'http://example.com/');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(normalizeUrl('  https://example.com  '), 'https://example.com/');
  });

  test('rejects an empty string', () => {
    assert.equal(normalizeUrl(''), null);
  });

  test('rejects a non-string input', () => {
    assert.equal(normalizeUrl(undefined), null);
    assert.equal(normalizeUrl(null), null);
    assert.equal(normalizeUrl(42), null);
  });

  test('rejects a string with no protocol', () => {
    assert.equal(normalizeUrl('example.com'), null);
  });

  test('rejects non-http(s) protocols', () => {
    assert.equal(normalizeUrl('ftp://example.com'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('file:///etc/passwd'), null);
  });

  test('preserves path and query string', () => {
    assert.equal(
      normalizeUrl('https://example.com/health?check=1'),
      'https://example.com/health?check=1'
    );
  });
});
