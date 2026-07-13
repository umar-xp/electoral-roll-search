/**
 * Search utilities — escaping, phonetic keys, scoring.
 * TypeScript port of search-utils.js (single source of truth).
 * @module search-utils
 */

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Generate phonetic key for fuzzy Indian name matching */
export function phoneticKey(name: string): string {
  if (!name) return '';
  let s = name.toLowerCase().trim();
  // Remove doubled consonants
  s = s.replace(/(.)\1+/g, '$1');
  // Normalize common transliteration equivalents
  s = s.replace(/th/g, 't');
  s = s.replace(/sh/g, 's');
  s = s.replace(/ph/g, 'f');
  s = s.replace(/gh/g, 'g');
  s = s.replace(/bh/g, 'b');
  s = s.replace(/dh/g, 'd');
  s = s.replace(/kh/g, 'k');
  s = s.replace(/ch/g, 'c');
  // Remove trailing vowels (common in Kannada transliteration)
  s = s.replace(/[aeiou]+$/, 'a');
  return s;
}

/** Consonant skeleton — strip vowels and collapse doubled consonants */
export function consonantSkeleton(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

/** Jaro similarity between two strings */
export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1m = new Array(len1).fill(false);
  const s2m = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const end = Math.min(len2, i + matchDist + 1);
    for (let j = Math.max(0, i - matchDist); j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0, trans = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }
  return (matches / len1 + matches / len2 + (matches - trans / 2) / matches) / 3;
}

/** Jaro-Winkler similarity — boosts score for common prefix */
export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

/** Double Metaphone phonetic encoding tuned for Indian names */
export function doubleMetaphone(str: string): [string, string] {
  const s = str.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return ['', ''];
  let primary = '', alternate = '', i = 0;
  const len = s.length;
  if (/^(gn|kn|pn|ae|wr)/.test(s)) i = 1;
  const at = (p: number) => p >= 0 && p < len ? s[p] : '';
  const sl = (p: number, n: number) => s.substring(p, p + n);
  while (i < len && primary.length < 6) {
    const c = s[i];
    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        if (i === 0) { primary += 'A'; alternate += 'A'; } i++; break;
      case 'b': primary += 'P'; alternate += 'P'; i += at(i+1)==='b'?2:1; break;
      case 'c':
        if (sl(i,2)==='ch') { primary+='X'; alternate+='X'; i+=2; }
        else if ('eiy'.includes(at(i+1))) { primary+='S'; alternate+='S'; i++; }
        else { primary+='K'; alternate+='K'; i+=(at(i+1)==='c'||at(i+1)==='k')?2:1; }
        break;
      case 'd':
        if (sl(i,2)==='dh') { primary+='T'; alternate+='T'; i+=2; }
        else { primary+='T'; alternate+='T'; i+=at(i+1)==='d'?2:1; } break;
      case 'f': primary+='F'; alternate+='P'; i+=at(i+1)==='f'?2:1; break;
      case 'g':
        if (sl(i,2)==='gh') { primary+='K'; alternate+='K'; i+=2; }
        else { primary+='K'; alternate+='K'; i+=at(i+1)==='g'?2:1; } break;
      case 'h':
        if ('aeiou'.includes(at(i+1))&&(i===0||!'aeiou'.includes(at(i-1)))) { primary+='H'; alternate+='H'; }
        i++; break;
      case 'j': primary+='J'; alternate+='J'; i+=at(i+1)==='j'?2:1; break;
      case 'k':
        if (sl(i,2)==='kh') { primary+='K'; alternate+='K'; i+=2; }
        else { primary+='K'; alternate+='K'; i+=at(i+1)==='k'?2:1; } break;
      case 'l': primary+='L'; alternate+='L'; i+=at(i+1)==='l'?2:1; break;
      case 'm': primary+='M'; alternate+='M'; i+=at(i+1)==='m'?2:1; break;
      case 'n': primary+='N'; alternate+='N'; i+=at(i+1)==='n'?2:1; break;
      case 'p':
        if (at(i+1)==='h') { primary+='F'; alternate+='P'; i+=2; }
        else { primary+='P'; alternate+='P'; i+=at(i+1)==='p'?2:1; } break;
      case 'q': primary+='K'; alternate+='K'; i+=at(i+1)==='q'?2:1; break;
      case 'r': primary+='R'; alternate+='R'; i+=at(i+1)==='r'?2:1; break;
      case 's':
        if (sl(i,2)==='sh') { primary+='X'; alternate+='S'; i+=2; }
        else { primary+='S'; alternate+='S'; i+=at(i+1)==='s'?2:1; } break;
      case 't':
        if (sl(i,2)==='th') { primary+='T'; alternate+='T'; i+=2; }
        else { primary+='T'; alternate+='T'; i+=at(i+1)==='t'?2:1; } break;
      case 'v': primary+='F'; alternate+='V'; i+=at(i+1)==='v'?2:1; break;
      case 'w': if ('aeiou'.includes(at(i+1))) { primary+='V'; alternate+='V'; } i++; break;
      case 'x': primary+='KS'; alternate+='KS'; i++; break;
      case 'y': if ('aeiou'.includes(at(i+1))) { primary+='Y'; alternate+='Y'; } i++; break;
      case 'z': primary+='J'; alternate+='S'; i+=at(i+1)==='z'?2:1; break;
      default: i++;
    }
  }
  return [primary.substring(0, 6), alternate.substring(0, 6)];
}

/** Levenshtein distance with early termination */
export function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (!a.length) return b.length > maxDist ? maxDist + 1 : b.length;
  if (!b.length) return a.length > maxDist ? maxDist + 1 : a.length;

  const lenA = a.length;
  const lenB = b.length;

  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;

  // Single-row DP
  const row: number[] = Array.from({ length: lenB + 1 }, (_, i) => i);

  for (let i = 1; i <= lenA; i++) {
    let prev = i;
    let rowMin = prev;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j] + 1,     // deletion
        prev + 1,       // insertion
        row[j - 1] + cost // substitution
      );
      row[j - 1] = prev;
      prev = val;
      if (val < rowMin) rowMin = val;
    }
    row[lenB] = prev;
    if (rowMin > maxDist) return maxDist + 1;
  }

  return row[lenB];
}

/** Score a single token against a target token (0-1) */
export function scoreToken(query: string, target: string): number {
  if (!query || !target) return 0;
  const q = query.toLowerCase().replace(/[\u200C\u200D]/g, '');
  const t = target.toLowerCase().replace(/[\u200C\u200D]/g, '');

  if (q === t) return 1.0;
  if (q.length < 3 || t.length < 3) return 0;
  if (t.startsWith(q) && q.length >= 4) return 0.9;
  if (q.startsWith(t) && t.length >= 4) return 0.85;

  // Phonetic key match
  const pq = phoneticKey(q);
  const pt = phoneticKey(t);
  if (pq === pt && q.length >= 4) return 0.8;

  // Jaro-Winkler (4+ chars) — check before edit distance for better scores
  if (Math.min(q.length, t.length) >= 4) {
    const jw = jaroWinkler(q, t);
    if (jw >= 0.92) return 0.85;
    if (jw >= 0.82) return 0.72;
  }

  // Double Metaphone
  if (q.length >= 3 && t.length >= 3) {
    const [qPri, qAlt] = doubleMetaphone(q);
    const [tPri, tAlt] = doubleMetaphone(t);
    if (qPri && tPri && (qPri === tPri || qPri === tAlt || qAlt === tPri || qAlt === tAlt)) return 0.72;
  }

  // Edit distance (similar length, both 5+ chars)
  if (Math.abs(q.length - t.length) <= 2 && Math.min(q.length, t.length) >= 5) {
    const dist = levenshtein(q, t, 2);
    if (dist === 1) return 0.7;
  }

  // Contains match
  if (q.length >= 4 && t.length >= 6 && t.includes(q)) return 0.7;

  // Consonant skeleton
  const qSkel = consonantSkeleton(q);
  const tSkel = consonantSkeleton(t);
  if (qSkel.length >= 2 && qSkel === tSkel && q[0] === t[0] && Math.min(q.length, t.length) >= 4) return 0.7;

  // Edit distance 2 — lower score fallback
  if (Math.abs(q.length - t.length) <= 2 && Math.min(q.length, t.length) >= 5) {
    const dist = levenshtein(q, t, 2);
    if (dist <= 2) return 0.5;
  }

  // Phonetic prefix
  if (pt.startsWith(pq) || pq.startsWith(pt)) return 0.45;

  return 0;
}

/** Score query tokens against record name tokens */
export function scoreNameMatch(queryTokens: string[], recordTokens: string[]): number {
  if (!queryTokens.length || !recordTokens.length) return 0;

  let totalScore = 0;
  for (const qt of queryTokens) {
    let bestScore = 0;
    for (const rt of recordTokens) {
      const s = scoreToken(qt, rt);
      if (s > bestScore) bestScore = s;
    }
    totalScore += bestScore;
  }

  return totalScore / queryTokens.length;
}

/** Tokenize a search query (handles English and Kannada) */
export function tokenizeQuery(input: string): string[] {
  if (!input || !input.trim()) return [];
  const trimmed = input.replace(/[\u200C\u200D]/g, '').trim();

  // If contains Kannada characters, keep as single token
  if (/[\u0C80-\u0CFF]/.test(trimmed)) {
    return [trimmed.toLowerCase()];
  }

  return trimmed
    .toLowerCase()
    .split(/[\s.,-]+/)
    .filter(t => t.length >= 2);
}

/** Check if a voter record has minimum required fields */
export function isValidVoterRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return !!(r.vk || r.vn || (Array.isArray(r.vt) && r.vt.length > 0));
}

/** Extract voter name tokens from a record */
export function getVoterTokens(record: Record<string, unknown>): string[] {
  if (Array.isArray(record.vt) && record.vt.length > 0) {
    return record.vt.map((t: unknown) => String(t || '').replace(/[\u200C\u200D]/g, '').toLowerCase()).filter(Boolean);
  }
  if (typeof record.vn === 'string' && record.vn) {
    return record.vn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
  }
  return [];
}

/** Extract relative name tokens from a record */
export function getRelativeTokens(record: Record<string, unknown>): string[] {
  if (Array.isArray(record.rnt) && record.rnt.length > 0) {
    return record.rnt.map((t: unknown) => String(t || '').replace(/[\u200C\u200D]/g, '').toLowerCase()).filter(Boolean);
  }
  if (typeof record.rn === 'string' && record.rn) {
    return record.rn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
  }
  return [];
}
