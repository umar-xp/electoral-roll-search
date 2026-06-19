/**
 * LRU Cache — O(1) Map-based implementation for voter part data.
 * @module lru-cache
 */

export class LRUCache<T> {
  private _map = new Map<string, T>();
  private _maxSize: number;

  constructor(maxSize: number) {
    this._maxSize = maxSize;
  }

  has(key: string): boolean {
    return this._map.has(key);
  }

  get(key: string): T | undefined {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key)!;
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Evict oldest (first key in Map iteration order)
      const oldestKey = this._map.keys().next().value;
      if (oldestKey !== undefined) {
        this._map.delete(oldestKey);
      }
    }
    this._map.set(key, value);
  }

  get size(): number {
    return this._map.size;
  }

  clear(): void {
    this._map.clear();
  }

  delete(key: string): boolean {
    return this._map.delete(key);
  }

  keys(): IterableIterator<string> {
    return this._map.keys();
  }

  values(): IterableIterator<T> {
    return this._map.values();
  }
}
