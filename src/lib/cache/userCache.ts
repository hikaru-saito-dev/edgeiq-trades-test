/**
 * High-performance in-memory cache for user lookups
 * Designed for Discord-scale performance without Redis dependency
 * 
 * Features:
 * - LRU eviction to prevent memory bloat
 * - TTL-based expiration
 * - Automatic cache invalidation
 * - Thread-safe operations
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

class UserCache {
  private cache: Map<string, CacheEntry<{ user: any; membership: any }>>;
  private maxSize: number;
  private defaultTTL: number; // milliseconds
  private accessOrder: string[]; // For LRU tracking

  constructor(maxSize = 10000, defaultTTL = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.accessOrder = [];
  }

  /**
   * Get cached user data
   */
  get(key: string): { user: any; membership: any } | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    // Update access tracking for LRU
    this.updateAccess(key);
    
    return entry.data;
  }

  /**
   * Set cached user data
   */
  set(key: string, data: { user: any; membership: any }, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    this.updateAccess(key);
  }

  /**
   * Delete cached entry
   */
  delete(key: string): void {
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Delete all entries matching a pattern (for invalidation)
   */
  deletePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    let totalAccess = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expired++;
      }
      totalAccess += entry.accessCount;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expired,
      totalAccess,
      hitRate: this.cache.size > 0 ? totalAccess / this.cache.size : 0,
    };
  }

  /**
   * Update access tracking for LRU
   */
  private updateAccess(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
    }

    // Move to end (most recently used)
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      // Fallback: delete first entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.delete(firstKey);
      }
      return;
    }

    const lruKey = this.accessOrder[0];
    this.delete(lruKey);
  }

  /**
   * Clean expired entries (call periodically)
   */
  cleanExpired(): number {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    return keysToDelete.length;
  }
}

// Singleton instance
export const userCache = new UserCache(
  parseInt(process.env.USER_CACHE_MAX_SIZE || '10000', 10),
  parseInt(process.env.USER_CACHE_TTL || '300000', 10) // 5 minutes default
);

// Clean expired entries every minute
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    userCache.cleanExpired();
  }, 60 * 1000);
}

/**
 * Generate cache key for user lookup
 */
export function getUserCacheKey(whopUserId: string, companyId: string): string {
  return `user:${whopUserId}:${companyId}`;
}

/**
 * Invalidate cache for a user (all companies or specific company)
 */
export function invalidateUserCache(whopUserId: string, companyId?: string): void {
  if (companyId) {
    userCache.delete(getUserCacheKey(whopUserId, companyId));
  } else {
    // Invalidate all entries for this user
    userCache.deletePattern(`^user:${whopUserId}:`);
  }
}

