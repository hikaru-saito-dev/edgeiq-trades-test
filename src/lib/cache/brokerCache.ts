/**
 * High-performance in-memory cache for active broker connections
 * Designed for Discord-scale performance without Redis dependency
 * 
 * Features:
 * - LRU eviction to prevent memory bloat
 * - TTL-based expiration
 * - Automatic cache invalidation
 */

import { TTLCache } from './ttlCache';
import type { IBrokerConnection } from '@/models/BrokerConnection';

// Cache active broker connections per user
// Key: `broker:${whopUserId}` or `broker:${userId}`
// TTL: 10 minutes (connections don't change often)
const activeBrokerCache = new TTLCache<IBrokerConnection | null>(10 * 60 * 1000);

/**
 * Get cached active broker connection for a user (by whopUserId)
 */
export function getActiveBrokerCacheByWhopUserId(whopUserId: string): IBrokerConnection | null | undefined {
    return activeBrokerCache.get(`broker:whop:${whopUserId}`);
}

/**
 * Set cached active broker connection for a user (by whopUserId)
 */
export function setActiveBrokerCacheByWhopUserId(
    whopUserId: string,
    connection: IBrokerConnection | null
): void {
    activeBrokerCache.set(`broker:whop:${whopUserId}`, connection);
}

/**
 * Get cached active broker connection for a user (by userId ObjectId)
 */
export function getActiveBrokerCacheByUserId(userId: string): IBrokerConnection | null | undefined {
    return activeBrokerCache.get(`broker:user:${userId}`);
}

/**
 * Set cached active broker connection for a user (by userId ObjectId)
 */
export function setActiveBrokerCacheByUserId(
    userId: string,
    connection: IBrokerConnection | null
): void {
    activeBrokerCache.set(`broker:user:${userId}`, connection);
}

/**
 * Invalidate broker cache for a user
 * Call this when a connection is created, updated, or deleted
 */
export function invalidateBrokerCache(whopUserId?: string, userId?: string): void {
    if (whopUserId) {
        activeBrokerCache.delete(`broker:whop:${whopUserId}`);
    }
    if (userId) {
        activeBrokerCache.delete(`broker:user:${userId}`);
    }
}

/**
 * Invalidate all broker caches
 */
export function clearBrokerCache(): void {
    activeBrokerCache.clear();
}

