/**
 * Edge caches (phase-01 1.4, phase-02 2.4): tenant status, membership permission version and
 * membership status. Written by event consumers (within ~1 s of the change) and, on a miss, by a
 * synchronous lookup against the owning service. In-memory by default; Redis when REDIS_URL is set
 * so several gateway instances share one view.
 */
import Redis from 'ioredis';

export interface StatusCache {
  get(key: string): Promise<{ value: string; version: number } | null>;
  /** Ignores writes with an older version than the stored one (out-of-order events). */
  set(key: string, value: string, version: number, ttlSec: number): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryStatusCache implements StatusCache {
  private readonly map = new Map<string, { value: string; version: number; expiresAt: number }>();
  async get(key: string) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return { value: hit.value, version: hit.version };
  }
  async set(key: string, value: string, version: number, ttlSec: number) {
    const existing = this.map.get(key);
    if (existing && existing.version > version && existing.expiresAt > Date.now()) return;
    this.map.set(key, { value, version, expiresAt: Date.now() + ttlSec * 1000 });
  }
  async clear() {
    this.map.clear();
  }
}

export class RedisStatusCache implements StatusCache {
  private readonly redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }
  async get(key: string) {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const idx = raw.indexOf(':');
    return { version: Number(raw.slice(0, idx)), value: raw.slice(idx + 1) };
  }
  async set(key: string, value: string, version: number, ttlSec: number) {
    const current = await this.get(key);
    if (current && current.version > version) return;
    await this.redis.set(key, `${version}:${value}`, 'EX', ttlSec);
  }
  async clear() {
    await this.redis.flushdb();
  }
  async close() {
    await this.redis.quit();
  }
}

export const cacheKeys = {
  tenantStatus: (tid: string) => `tenant-status:${tid}`,
  permissionVersion: (mid: string) => `permver:${mid}`,
  memberStatus: (mid: string) => `member-status:${mid}`,
};
