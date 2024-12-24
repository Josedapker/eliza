import {
    Browser,
    BrowserContext,
    chromium,
    Page,
} from 'playwright';

import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';

import { Cache } from '../utils/cache';

export class BrowserService {
    private static instance: BrowserService;

    private browser: Browser | undefined;
    private context: BrowserContext | undefined;
    private blocker: PlaywrightBlocker | undefined;
    private cache: Cache;

    public static getInstance(): BrowserService {
        if (!BrowserService.instance) {
            BrowserService.instance = new BrowserService();
        }
        return BrowserService.instance;
    }

    private constructor() {
        this.browser = undefined;
        this.context = undefined;
        this.blocker = undefined;
        this.cache = Cache.getInstance();
    }

    async init() {
        await this.initializeBrowser();
    }

    async initializeBrowser() {
        if (!this.browser) {
            console.log('Initializing browser...');
            this.browser = await chromium.launch({
                headless: true,
                args: [
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-setuid-sandbox"
                ]
            });

            const platform = process.platform;
            let userAgent = "";
            switch (platform) {
                case "darwin":
                    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
                    break;
                case "win32":
                    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
                    break;
                default:
                    userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
            }

            console.log('Creating browser context...');
            this.context = await this.browser.newContext({
                userAgent,
                acceptDownloads: false,
                viewport: { width: 1920, height: 1080 },
                deviceScaleFactor: 1,
                extraHTTPHeaders: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1'
                },
            });

            // Initialize adblocker with less aggressive rules
            console.log('Initializing adblocker...');
            this.blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
            if (this.context && this.blocker) {
                const page = await this.context.newPage();
                // Only block known ad domains and trackers
                await this.blocker.enableBlockingInPage(page);
                await page.route('**/*', async (route) => {
                    const request = route.request();
                    if (this.blocker && await this.blocker.shouldBlock(request.url(), {
                        sourceUrl: request.frame()?.url(),
                        requestType: request.resourceType(),
                    })) {
                        await route.abort();
                    } else {
                        await route.continue();
                    }
                });
                await page.close();
            } else {
                console.error('Browser context or adblocker is not initialized');
            }

            // Add more realistic browser behavior
            await this.context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
        }
    }

    async newPage(): Promise<Page> {
        if (!this.context) {
            await this.init();
        }
        if (!this.context) {
            throw new Error('Browser context not initialized');
        }
        const page = await this.context.newPage();

        // Add debug event listeners
        page.on('console', msg => console.log('Browser console:', msg.text()));
        page.on('pageerror', err => console.error('Browser error:', err));
        page.on('requestfailed', request =>
            console.error('Failed request:', request.url(), request.failure()?.errorText)
        );

        // Enable stealth mode
        await page.setExtraHTTPHeaders({
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        });

        // Apply ad blocker
        if (this.blocker) {
            await this.blocker.enableBlockingInPage(page);
        }

        return page;
    }

    async close() {
        if (this.context) {
            await this.context.close();
            this.context = undefined;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = undefined;
        }
    }

    async getPage(url: string, options: { cacheTimeout?: number } = {}): Promise<Page> {
        const page = await this.newPage();

        // Add random delay between requests
        const delay = Math.random() * 2000 + 1000;
        console.log(`Adding random delay: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Try to load the page with retries
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempt ${attempt}/${maxRetries} to load ${url}`);
                const response = await page.goto(url, {
                    waitUntil: "networkidle",
                    timeout: 60000 // Increased timeout
                });

                if (!response) {
                    throw new Error('No response received');
                }

                const status = response.status();
                console.log(`Page loaded with status: ${status}`);

                if (status >= 400) {
                    throw new Error(`HTTP error! status: ${status}`);
                }

                // Wait a bit for any dynamic content
                await page.waitForTimeout(2000);

                return page;
            } catch (error) {
                console.error(`Failed to load page (attempt ${attempt}/${maxRetries}):`, error);
                if (attempt === maxRetries) {
                    throw error;
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        throw new Error('Failed to load page after all retries');
    }

    async getPageContent(url: string, selector: string, cacheTimeout: number = 15 * 60 * 1000): Promise<string> {
        // Check cache first
        const cachedContent = await this.cache.get<string>(url);
        if (cachedContent) {
            return cachedContent;
        }

        const page = await this.getPage(url);
        try {
            // First wait for the page to be generally ready
            await page.waitForLoadState('domcontentloaded');
            await page.waitForLoadState('load');

            // Then wait for either the specific selector or any content
            try {
                await Promise.race([
                    page.waitForSelector(selector, { timeout: 15000 }),
                    page.waitForSelector('body > *', { timeout: 15000 })
                ]);
            } catch (error) {
                console.log('Specific selector not found, proceeding with available content');
            }

            // Add a small delay to let dynamic content load
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

            const content = await page.content();

            // Cache the result
            await this.cache.set(url, content, cacheTimeout);

            return content;
        } finally {
            await page.close();
        }
    }
}
