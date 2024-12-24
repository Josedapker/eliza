import { Browser, BrowserContext, chromium, Page } from "playwright";

import { RequestType } from "@ghostery/adblocker";
import { PlaywrightBlocker } from "@ghostery/adblocker-playwright";

export class BrowserService {
    private static instance: BrowserService;
    private browser: Browser | undefined;
    private context: BrowserContext | undefined;
    private blocker: PlaywrightBlocker | undefined;

    private constructor() {}

    public static getInstance(): BrowserService {
        if (!BrowserService.instance) {
            BrowserService.instance = new BrowserService();
        }
        return BrowserService.instance;
    }

    private mapResourceType(type: string): RequestType {
        switch (type) {
            case "document":
                return "document";
            case "stylesheet":
                return "stylesheet";
            case "image":
                return "image";
            case "media":
                return "media";
            case "font":
                return "font";
            case "script":
                return "script";
            case "xhr":
            case "fetch":
                return "xhr";
            case "websocket":
                return "websocket";
            case "other":
            default:
                return "other";
        }
    }

    async newPage(): Promise<Page> {
        if (!this.browser || !this.context) {
            await this.initialize();
        }

        if (!this.context) {
            throw new Error("Browser context not initialized");
        }

        const page = await this.context.newPage();
        return page;
    }

    async initialize() {
        if (!this.browser) {
            this.browser = await chromium.launch({
                headless: true,
                args: [
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-setuid-sandbox",
                    "--no-sandbox",
                ],
            });

            const platform = process.platform;
            let userAgent = "";

            // Set platform-specific user agent
            switch (platform) {
                case "darwin":
                    userAgent =
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
                    break;
                case "win32":
                    userAgent =
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
                    break;
                default:
                    userAgent =
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
            }

            this.context = await this.browser.newContext({
                userAgent,
                viewport: { width: 1920, height: 1080 },
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                javaScriptEnabled: true,
                acceptDownloads: false,
                extraHTTPHeaders: {
                    "Accept-Language": "en-US,en;q=0.9",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    Connection: "keep-alive",
                    DNT: "1",
                },
            });

            // Initialize and enable ad blocker
            this.blocker =
                await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);

            // Set up default route handling for the context
            await this.context.route("**/*", async (route) => {
                const request = route.request();
                const url = request.url();
                const resourceType = request.resourceType();

                // Only block known ad/tracking domains
                if (
                    (this.blocker && url.includes("google-analytics.com")) ||
                    url.includes("doubleclick.net") ||
                    url.includes("facebook.com")
                ) {
                    await route.abort();
                    return;
                }

                // Allow essential resource types
                if (
                    resourceType === "document" ||
                    resourceType === "script" ||
                    resourceType === "stylesheet" ||
                    resourceType === "xhr" ||
                    resourceType === "fetch"
                ) {
                    await route.continue();
                    return;
                }

                // Block non-essential resource types
                if (
                    resourceType === "image" ||
                    resourceType === "media" ||
                    resourceType === "font"
                ) {
                    await route.abort();
                    return;
                }

                // Continue by default
                await route.continue();
            });
        }
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
}
