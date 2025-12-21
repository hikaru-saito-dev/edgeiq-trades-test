/**
 * High-performance in-memory cache for active follow purchases
 * Designed for Discord-scale performance without Redis dependency
 * 
 * Features:
 * - LRU eviction to prevent memory bloat
 * - TTL-based expiration
 * - Automatic cache invalidation
 */

import { TTLCache } from './ttlCache';
import type { IFollowPurchase } from '@/models/FollowPurchase';

// Cache active follows per follower
// Key: `follow:${followerWhopUserId}`
// TTL: 5 minutes (follows don't change frequently, but need to reflect consumption)
const activeFollowsCache = new TTLCache<IFollowPurchase[]>(5 * 60 * 1000);

// Cache single follow lookup
// Key: `follow:${followerWhopUserId}:${capperWhopUserId}`
// TTL: 5 minutes
const singleFollowCache = new TTLCache<IFollowPurchase | null>(5 * 60 * 1000);

/**
 * Get cached active follows for a follower
 */
export function getActiveFollowsCache(followerWhopUserId: string): IFollowPurchase[] | null {
    const cached = activeFollowsCache.get(`follow:${followerWhopUserId}`);
    return cached ?? null;
}

/**
 * Set cached active follows for a follower
 */
export function setActiveFollowsCache(followerWhopUserId: string, follows: IFollowPurchase[]): void {
    activeFollowsCache.set(`follow:${followerWhopUserId}`, follows);
}

/**
 * Get cached single follow lookup
 */
export function getSingleFollowCache(
    followerWhopUserId: string,
    capperWhopUserId: string
): IFollowPurchase | null | undefined {
    return singleFollowCache.get(`follow:${followerWhopUserId}:${capperWhopUserId}`);
}

/**
 * Set cached single follow lookup
 */
export function setSingleFollowCache(
    followerWhopUserId: string,
    capperWhopUserId: string,
    follow: IFollowPurchase | null
): void {
    singleFollowCache.set(`follow:${followerWhopUserId}:${capperWhopUserId}`, follow);
}

/**
 * Invalidate all caches for a follower
 * Call this when a follow purchase is created, consumed, or updated
 */
export function invalidateFollowCache(followerWhopUserId: string): void {
    activeFollowsCache.deleteByPrefix(`follow:${followerWhopUserId}`);
    singleFollowCache.deleteByPrefix(`follow:${followerWhopUserId}:`);
}

/**
 * Invalidate all follow caches
 */
export function clearFollowCache(): void {
    activeFollowsCache.clear();
    singleFollowCache.clear();
}

