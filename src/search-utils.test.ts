import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  phoneticKey,
  levenshtein,
  scoreToken,
  scoreNameMatch,
  tokenizeQuery,
  isValidVoterRecord,
  getVoterTokens,
  getRelativeTokens,
  consonantSkeleton,
  jaro,
  jaroWinkler,
  doubleMetaphone,
} from './search-utils';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe(
      '&quot;hello&quot; &amp; &#39;world&#39;'
    );
  });

  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('passes through safe strings', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles numbers', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('phoneticKey', () => {
  it('reduces doubled consonants', () => {
    expect(phoneticKey('Shivappa')).toBe(phoneticKey('Shivapa'));
  });

  it('normalizes th/t', () => {
    expect(phoneticKey('Ramantha')).toBe(phoneticKey('Ramanta'));
  });

  it('normalizes trailing vowels', () => {
    // 'Kumara' and 'Kumare' both end with trailing vowels → normalized to same key
    expect(phoneticKey('Kumara')).toBe(phoneticKey('Kumare'));
    expect(phoneticKey('Kumaru')).toBe(phoneticKey('Kumara'));
  });

  it('normalizes sh/s', () => {
    expect(phoneticKey('Shiva')).toBe(phoneticKey('Siva'));
  });

  it('handles empty string', () => {
    expect(phoneticKey('')).toBe('');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('test', 'test', 3)).toBe(0);
  });

  it('counts single substitution', () => {
    expect(levenshtein('test', 'tost', 3)).toBe(1);
  });

  it('counts single insertion', () => {
    expect(levenshtein('test', 'tests', 3)).toBe(1);
  });

  it('counts single deletion', () => {
    expect(levenshtein('test', 'tes', 3)).toBe(1);
  });

  it('terminates early when exceeding maxDist', () => {
    expect(levenshtein('abc', 'xyz', 2)).toBe(3);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', '', 3)).toBe(0);
    expect(levenshtein('abc', '', 5)).toBe(3);
    expect(levenshtein('', 'abc', 5)).toBe(3);
  });

  it('returns maxDist+1 when empty string exceeds maxDist', () => {
    expect(levenshtein('', 'abcdef', 2)).toBe(3);
    expect(levenshtein('abcdef', '', 2)).toBe(3);
  });
});

describe('scoreToken', () => {
  it('exact match = 1.0', () => {
    expect(scoreToken('mohammed', 'mohammed')).toBe(1.0);
  });

  it('prefix match >= 0.85', () => {
    expect(scoreToken('moham', 'mohammed')).toBeGreaterThanOrEqual(0.85);
  });

  it('edit distance 1 returns > 0', () => {
    expect(scoreToken('mohammd', 'mohammed')).toBeGreaterThan(0);
  });

  it('contains match returns >= 0.6', () => {
    expect(scoreToken('hamme', 'mohammed')).toBeGreaterThanOrEqual(0.6);
  });

  it('phonetic match returns >= 0.72', () => {
    // 'bhagghavath' and 'bagavat' have same phoneticKey
    expect(scoreToken('bhagghavath', 'bagavat')).toBeGreaterThanOrEqual(0.72);
  });

  it('phonetic prefix match returns 0.45', () => {
    expect(scoreToken('dhanush', 'danushkodi')).toBe(0.45);
  });

  it('handles empty inputs', () => {
    expect(scoreToken('', 'mohammed')).toBe(0);
    expect(scoreToken('mohammed', '')).toBe(0);
  });

  it('no match returns 0', () => {
    expect(scoreToken('xyz', 'mohammed')).toBe(0);
  });

  it('handles ZWNJ in tokens', () => {
    // ZWNJ (\u200C) should be stripped before comparison
    expect(scoreToken('ummar', 'ummar\u200C')).toBe(1.0);
    expect(scoreToken('saleem', 'saleem\u200C')).toBe(1.0);
  });

  it('short tokens (< 3 chars) return 0 for non-exact match', () => {
    expect(scoreToken('ab', 'abc')).toBe(0);
    expect(scoreToken('um', 'ummar')).toBe(0);
  });

  // --- Jaro-Winkler cases ---
  it('Jaro-Winkler: umer vs ummar scores > 0.7', () => {
    // These are close enough for JW (common first letters)
    expect(scoreToken('umer', 'ummar')).toBeGreaterThan(0.7);
  });

  it('Jaro-Winkler: saleem vs salim scores > 0.7', () => {
    expect(scoreToken('saleem', 'salim')).toBeGreaterThan(0.7);
  });

  it('Jaro-Winkler: hussain vs husain scores > 0.7', () => {
    expect(scoreToken('hussain', 'husain')).toBeGreaterThan(0.7);
  });

  // --- Double Metaphone cases ---
  it('Double Metaphone: fazal vs phasal scores > 0.5', () => {
    // f→F and ph→F should give same code
    expect(scoreToken('fazal', 'phasal')).toBeGreaterThan(0.5);
  });

  // --- Consonant skeleton cases ---
  it('consonant skeleton: kumar vs kamar scores >= 0.7', () => {
    // Both: k-m-r skeleton with same first letter
    expect(scoreToken('kumar', 'kamar')).toBeGreaterThanOrEqual(0.7);
  });

  it('consonant skeleton: saleem vs salim scores >= 0.7', () => {
    // Both: s-l-m skeleton
    expect(scoreToken('saleem', 'salim')).toBeGreaterThanOrEqual(0.7);
  });
});

describe('scoreNameMatch', () => {
  it('exact match scores >= 0.9', () => {
    expect(scoreNameMatch(['mohammed'], ['mohammed'])).toBeGreaterThanOrEqual(0.9);
  });

  it('partial match scores > 0', () => {
    expect(scoreNameMatch(['moham'], ['mohammed'])).toBeGreaterThan(0);
  });

  it('no match returns 0', () => {
    expect(scoreNameMatch(['xyz'], ['abc'])).toBe(0);
  });

  it('empty inputs return 0', () => {
    expect(scoreNameMatch([], ['abc'])).toBe(0);
    expect(scoreNameMatch(['abc'], [])).toBe(0);
  });
});

describe('tokenizeQuery', () => {
  it('splits English input into tokens', () => {
    expect(tokenizeQuery('Abdul Rehman')).toEqual(['abdul', 'rehman']);
  });

  it('keeps Kannada input as single token', () => {
    expect(tokenizeQuery('ಮೊಹಮ್ಮದ')).toEqual(['ಮೊಹಮ್ಮದ']);
  });

  it('filters short tokens', () => {
    expect(tokenizeQuery('A B longword')).toEqual(['longword']);
  });

  it('handles empty input', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });

  it('strips ZWNJ characters before tokenizing', () => {
    expect(tokenizeQuery('Ummar\u200C Saleem')).toEqual(['ummar', 'saleem']);
    expect(tokenizeQuery('ಉಮ್ಮರ್\u200C ಸಲೀಂ')).toEqual(['ಉಮ್ಮರ್ ಸಲೀಂ']);
  });

  it('handles Kannada multi-word names', () => {
    expect(tokenizeQuery('ಉಮ್ಮರ್ ಸಲೀಂ')).toEqual(['ಉಮ್ಮರ್ ಸಲೀಂ']);
  });
});

describe('isValidVoterRecord', () => {
  it('valid record with vk', () => {
    expect(isValidVoterRecord({ vk: 'ಮೊಹಮ್ಮದ', vn: '', rn: '' })).toBe(true);
  });

  it('valid record with vn', () => {
    expect(isValidVoterRecord({ vn: 'Mohammed', vk: '', rn: '' })).toBe(true);
  });

  it('valid record with vt array', () => {
    expect(isValidVoterRecord({ vt: ['Mohammed'], vk: '', vn: '' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidVoterRecord(null)).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isValidVoterRecord({})).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidVoterRecord('string')).toBe(false);
    expect(isValidVoterRecord(42)).toBe(false);
  });
});

describe('getVoterTokens', () => {
  it('uses vt field when present', () => {
    expect(getVoterTokens({ vt: ['Mohammed', 'Khan'] })).toEqual(['mohammed', 'khan']);
  });

  it('handles null/falsy values in vt array', () => {
    expect(getVoterTokens({ vt: ['Mohammed', null, '', 'Khan'] })).toEqual(['mohammed', 'khan']);
  });

  it('falls back to vn field', () => {
    expect(getVoterTokens({ vn: 'Mohammed Khan' })).toEqual(['mohammed', 'khan']);
  });

  it('returns empty for missing fields', () => {
    expect(getVoterTokens({})).toEqual([]);
  });
});

describe('getRelativeTokens', () => {
  it('uses rnt field when present', () => {
    expect(getRelativeTokens({ rnt: ['Ibrahim'] })).toEqual(['ibrahim']);
  });

  it('handles null/falsy values in rnt array', () => {
    expect(getRelativeTokens({ rnt: ['Ibrahim', null, ''] })).toEqual(['ibrahim']);
  });

  it('falls back to rn field', () => {
    expect(getRelativeTokens({ rn: 'Abdul Rehman' })).toEqual(['abdul', 'rehman']);
  });

  it('returns empty for missing fields', () => {
    expect(getRelativeTokens({})).toEqual([]);
  });

  it('strips ZWNJ from relative tokens', () => {
    expect(getRelativeTokens({ rnt: ['Nazeer\u200C'] })).toEqual(['nazeer']);
    expect(getRelativeTokens({ rn: 'Abdul\u200C Rehman' })).toEqual(['abdul', 'rehman']);
  });
});

// =============================================================================
// New Algorithm Tests
// =============================================================================

describe('consonantSkeleton', () => {
  it('strips vowels and collapses doubles', () => {
    expect(consonantSkeleton('umer')).toBe('mr');
    expect(consonantSkeleton('ummar')).toBe('mr');
  });

  it('produces same skeleton for transliteration variants', () => {
    expect(consonantSkeleton('saleem')).toBe(consonantSkeleton('salim'));
    expect(consonantSkeleton('kumar')).toBe(consonantSkeleton('kamar'));
    expect(consonantSkeleton('mohammed')).toBe(consonantSkeleton('mohamad'));
  });

  it('handles empty input', () => {
    expect(consonantSkeleton('')).toBe('');
  });

  it('strips non-alphabetic characters', () => {
    expect(consonantSkeleton('um-mar')).toBe('mr');
    expect(consonantSkeleton("sa'leem")).toBe('slm');
  });

  it('different names produce different skeletons', () => {
    expect(consonantSkeleton('kumar')).not.toBe(consonantSkeleton('saleem'));
    expect(consonantSkeleton('ravi')).not.toBe(consonantSkeleton('devi'));
  });
});

describe('jaro', () => {
  it('identical strings = 1.0', () => {
    expect(jaro('hello', 'hello')).toBe(1.0);
  });

  it('completely different strings ≈ 0', () => {
    expect(jaro('abc', 'xyz')).toBe(0);
  });

  it('empty strings return 0', () => {
    expect(jaro('', 'abc')).toBe(0);
    expect(jaro('abc', '')).toBe(0);
  });

  it('single transposition scores < 1.0', () => {
    expect(jaro('abcd', 'abdc')).toBeLessThan(1.0);
    expect(jaro('abcd', 'abdc')).toBeGreaterThan(0.8);
  });
});

describe('jaroWinkler', () => {
  it('identical strings = 1.0', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1.0);
  });

  it('common prefix boosts score above jaro', () => {
    const j = jaro('umer', 'ummar');
    const jw = jaroWinkler('umer', 'ummar');
    expect(jw).toBeGreaterThanOrEqual(j);
  });

  it('umer vs ummar >= 0.82', () => {
    expect(jaroWinkler('umer', 'ummar')).toBeGreaterThanOrEqual(0.82);
  });

  it('saleem vs salim >= 0.82', () => {
    expect(jaroWinkler('saleem', 'salim')).toBeGreaterThanOrEqual(0.82);
  });

  it('hussain vs husain >= 0.9', () => {
    expect(jaroWinkler('hussain', 'husain')).toBeGreaterThanOrEqual(0.9);
  });

  it('completely different = low score', () => {
    expect(jaroWinkler('xyz', 'abc')).toBeLessThan(0.5);
  });

  it('Mohammed vs Mohamad >= 0.85', () => {
    expect(jaroWinkler('mohammed', 'mohamad')).toBeGreaterThanOrEqual(0.85);
  });
});

describe('doubleMetaphone', () => {
  it('returns [primary, alternate] tuple', () => {
    const result = doubleMetaphone('test');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  it('empty string returns empty codes', () => {
    expect(doubleMetaphone('')).toEqual(['', '']);
  });

  it('f and ph produce same primary code', () => {
    const [fPri] = doubleMetaphone('fazal');
    const [phPri] = doubleMetaphone('phazal');
    expect(fPri).toBe(phPri);
  });

  it('sh and s have different primary but s matches alternate', () => {
    const [, shAlt] = doubleMetaphone('shah');
    const [sPri] = doubleMetaphone('sah');
    // sh→X (primary), sh→S (alternate); s→S
    expect(shAlt).toBe(sPri);
  });

  it('doubled consonants collapse', () => {
    const [ummerPri] = doubleMetaphone('ummer');
    const [umerPri] = doubleMetaphone('umer');
    expect(ummerPri).toBe(umerPri);
  });

  it('Mohammed and Mohamad produce same primary', () => {
    const [mPri] = doubleMetaphone('mohammed');
    const [mPri2] = doubleMetaphone('mohamad');
    expect(mPri).toBe(mPri2);
  });

  it('z and j relationship (z→J primary, s alternate)', () => {
    const [zPri, zAlt] = doubleMetaphone('zahir');
    expect(zPri.startsWith('J')).toBe(true);
    expect(zAlt.startsWith('S')).toBe(true);
  });

  it('kh and k collapse', () => {
    const [khPri] = doubleMetaphone('khan');
    const [kPri] = doubleMetaphone('kan');
    expect(khPri).toBe(kPri);
  });

  it('Indian name variants produce same primary', () => {
    const [p1] = doubleMetaphone('ramesh');
    const [p2] = doubleMetaphone('rammesh');
    expect(p1).toBe(p2);
  });
});

describe('ZWNJ handling in getVoterTokens', () => {
  it('strips ZWNJ from vt tokens', () => {
    expect(getVoterTokens({ vt: ['Ummar\u200C', 'Saleem\u200C'] }))
      .toEqual(['ummar', 'saleem']);
  });

  it('strips ZWNJ from vn field', () => {
    expect(getVoterTokens({ vn: 'Ummar\u200C Saleem\u200C' }))
      .toEqual(['ummar', 'saleem']);
  });
});

describe('Integration: scoreNameMatch with Indian name variants', () => {
  it('umer vs ummar saleem scores well', () => {
    const score = scoreNameMatch(['umer', 'saleem'], ['ummar', 'saleem']);
    expect(score).toBeGreaterThan(0.8);
  });

  it('mohammed vs mohamad khan scores well', () => {
    const score = scoreNameMatch(['mohammed', 'khan'], ['mohamad', 'khan']);
    expect(score).toBeGreaterThan(0.8);
  });

  it('hussain vs husain scores well', () => {
    const score = scoreNameMatch(['hussain'], ['husain']);
    expect(score).toBeGreaterThan(0.7);
  });

  it('completely different names score 0', () => {
    const score = scoreNameMatch(['ravi', 'kumar'], ['zahir', 'ahmed']);
    expect(score).toBe(0);
  });

  it('single token partial match still scores', () => {
    const score = scoreNameMatch(['saleem'], ['salim']);
    expect(score).toBeGreaterThan(0.7);
  });

  it('handles ZWNJ in record tokens transparently', () => {
    // The voter record has ZWNJ but query doesn't
    const voterTokens = getVoterTokens({ vt: ['Ummar\u200C', 'Saleem\u200C'] });
    const queryTokens = tokenizeQuery('umer saleem');
    const score = scoreNameMatch(queryTokens, voterTokens);
    expect(score).toBeGreaterThan(0.7);
  });

  it('Kannada tokenization preserves full name', () => {
    const tokens = tokenizeQuery('ಉಮ್ಮರ್ ಸಲೀಂ');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toContain('ಉಮ್ಮರ್');
  });
});
