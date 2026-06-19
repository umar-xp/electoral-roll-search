import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string>(5);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts oldest entry when exceeding max size', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // Should evict 'a'

    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
    expect(cache.size).toBe(3);
  });

  it('access refreshes position (prevents eviction)', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it most recently used
    cache.get('a');

    // Add 'd' — should evict 'b' (oldest non-accessed)
    cache.set('d', 4);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('overwriting a key refreshes its position', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Overwrite 'a'
    cache.set('a', 10);

    // Add 'd' — should evict 'b'
    cache.set('d', 4);

    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
  });

  it('clear removes all entries', () => {
    const cache = new LRUCache<number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });

  it('delete removes a specific entry', () => {
    const cache = new LRUCache<number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('delete returns true for existing key', () => {
    const cache = new LRUCache<number>(5);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
  });

  it('delete returns false for missing key', () => {
    const cache = new LRUCache<number>(5);
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('keys() returns all keys in insertion order', () => {
    const cache = new LRUCache<number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect([...cache.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('values() returns all values in insertion order', () => {
    const cache = new LRUCache<number>(5);
    cache.set('x', 10);
    cache.set('y', 20);
    expect([...cache.values()]).toEqual([10, 20]);
  });

  it('handles maxSize of 1', () => {
    const cache = new LRUCache<string>(1);
    cache.set('a', 'first');
    expect(cache.get('a')).toBe('first');
    cache.set('b', 'second');
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe('second');
    expect(cache.size).toBe(1);
  });

  it('set with existing key does not increase size', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
  });

  it('eviction order is correct after multiple accesses', () => {
    const cache = new LRUCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // refresh a
    cache.get('b'); // refresh b
    cache.set('d', 4); // evict c (oldest)
    expect(cache.has('c')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('works with complex object values', () => {
    const cache = new LRUCache<{ name: string; age: number }>(5);
    cache.set('user1', { name: 'Alice', age: 30 });
    expect(cache.get('user1')).toEqual({ name: 'Alice', age: 30 });
  });
});
