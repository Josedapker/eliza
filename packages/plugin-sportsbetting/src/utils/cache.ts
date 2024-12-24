import { promises as fs } from 'fs';
import { join } from 'path';
import { MatchPreview } from '../actions/getData';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    expiresAt: number;
}

export class Cache {
    private static instance: Cache;
    private cacheDir: string;
    private cacheExpiry: number; // in milliseconds

    private constructor() {
        this.cacheDir = join(process.cwd(), '.cache');
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes default
    }

    public static getInstance(): Cache {
        if (!Cache.instance) {
            Cache.instance = new Cache();
        }
        return Cache.instance;
    }

    private async ensureCacheDir(): Promise<void> {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create cache directory:', error);
        }
    }

    private getCacheKey(key: string): string {
        // Create a valid filename from the key
        const safeKey = encodeURIComponent(key).replace(/%/g, '_');
        return join(this.cacheDir, `${safeKey}.json`);
    }

    public async get<T>(key: string): Promise<T | null> {
        try {
            const cacheFile = this.getCacheKey(key);
            const data = await fs.readFile(cacheFile, 'utf-8');
            const cache: CacheEntry<T> = JSON.parse(data);

            if (Date.now() > cache.expiresAt) {
                await this.delete(key);
                return null;
            }

            return cache.data;
        } catch (error) {
            return null;
        }
    }

    public async set<T>(key: string, data: T, ttl: number = this.cacheExpiry): Promise<void> {
        try {
            await this.ensureCacheDir();
            const cacheFile = this.getCacheKey(key);
            const cache: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                expiresAt: Date.now() + ttl,
            };
            await fs.writeFile(cacheFile, JSON.stringify(cache), 'utf-8');
        } catch (error) {
            console.error('Failed to write to cache:', error);
        }
    }

    public async delete(key: string): Promise<void> {
        try {
            const cacheFile = this.getCacheKey(key);
            await fs.unlink(cacheFile);
        } catch (error) {
            // Ignore if file doesn't exist
        }
    }
}
