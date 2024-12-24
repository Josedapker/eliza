import axios from "axios";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { ConsoleMessage, Page, Route } from "playwright";

import { DiscordBot } from "./discord-bot";
import { BrowserService } from "./services/browser";
import { MatchPreview, PreviewSection, PreviewMatch } from './types';

// Additional interfaces
interface CacheEntry {
    data: MatchPreview | null;
    timestamp: number;
}

interface FormResult {
    opponent: string;
    result: string;
    score: string;
}

interface MatchStats {
    possession: {
        home: string;
        away: string;
    };
    shots: {
        home: string;
        away: string;
    };
    shotsOnTarget: {
        home: string;
        away: string;
    };
    corners: {
        home: string;
        away: string;
    };
    fouls: {
        home: string;
        away: string;
    };
    homeWinProbability: number;
    drawProbability: number;
    awayWinProbability: number;
    trend: number;
    drawTrend: number;
    awayTrend: number;
    bttsProbability: number;
    bttsTrend: number;
    over25Probability: number;
    over25Trend: number;
    over35Probability: number;
    over35Trend: number;
    homeOver05: number;
    homeOver15: number;
    awayOver05: number;
    awayOver15: number;
    scoreLines: Array<{
        score: string;
        probability: number;
        trend: number;
    }>;
}

interface DiscordEmbed {
    title: string;
    description?: string;
    color: number;
    url?: string;
    thumbnail?: {
        url: string;
    };
    image?: {
        url: string;
    };
    author?: {
        name: string;
        icon_url?: string;
    };
    fields?: {
        name: string;
        value: string;
        inline?: boolean;
    }[];
    footer?: {
        text: string;
    };
    timestamp?: string;
}

interface DiscordMessage {
    embeds: DiscordEmbed[];
}

interface FormData {
    home: string[];
    away: string[];
}

interface MatchAnalysisData {
    homeWinProb: string;
    drawProb: string;
    awayWinProb: string;
    bttsProb: string;
    over25Prob: string;
    scorelinePredictions: Array<{ score: string; probability: string }>;
    dataAnalysisUrl?: string;
}

// Constants and global variables
const articleCache = new Map<string, CacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Load environment variables
dotenv.config();

// Try to load .env from different possible locations
const envPaths = [
    path.join(__dirname, "..", "..", "..", ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, ".env"),
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        console.log("Loading .env from:", envPath);
        dotenv.config({ path: envPath });
        break;
    }
}

// Validate required environment variables
const DISCORD_API_TOKEN = process.env.DISCORD_API_TOKEN;
if (!DISCORD_API_TOKEN) {
    console.error("❌ ERROR: DISCORD_API_TOKEN is not set in .env file");
    process.exit(1);
}

// Initialize the bot
const bot = new DiscordBot(DISCORD_API_TOKEN);

console.log("✅ Environment variables loaded successfully");
console.log("Discord bot token:", DISCORD_API_TOKEN.substring(0, 20) + "...");

// Add this right after bot initialization
bot.client.once("ready", () => {
    log.success(`Bot logged in as ${bot.client.user?.tag}`);
    // Verify channel access
    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (channelId) {
        const channel = bot.client.channels.cache.get(channelId);
        if (channel) {
            log.success("Successfully found Discord channel");
        } else {
            log.error(
                "Could not find Discord channel - check DISCORD_CHANNEL_ID"
            );
        }
    }
});

// Helper function for page navigation with retries
async function navigateWithRetry(
    page: Page,
    url: string,
    maxRetries = 3
): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            log.info(`Navigating to page (attempt ${i + 1}/${maxRetries})`);

            // Clear cookies and cache before navigation
            const client = await page.context().newCDPSession(page);
            await client.send("Network.clearBrowserCookies");
            await client.send("Network.clearBrowserCache");

            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            log.success("Navigation successful");
            return true;
        } catch (err) {
            const error = err as Error;
            log.error(`Navigation attempt ${i + 1} failed: ${error.message}`);

            if (i === maxRetries - 1) throw error;
            await page.waitForTimeout(2000);
        }
    }
    return false;
}

async function getPreviewLinks(page: Page): Promise<PreviewSection[]> {
    try {
        console.log("Getting preview links...");
        const previewLinks: PreviewSection[] = [];
        let currentSection: PreviewSection | undefined;

        const rows = await page.$$("table.matches tr");

        for (const row of rows) {
            const isSection = await row.getAttribute("class") === "section";
            
            if (isSection) {
                if (currentSection) {
                    previewLinks.push(currentSection);
                }
                const sectionTitle = await row.$eval("td", (el) => el.textContent?.trim() || "");
                currentSection = {
                    section: sectionTitle,
                    matches: []
                };
            } else if (currentSection) {
                const cells = await row.$$("td");
                if (cells.length >= 3) {
                    const time = await cells[0].evaluate((el) => el.textContent?.trim() || "");
                    const matchCell = cells[2];
                    const matchText = await matchCell.evaluate((el) => el.textContent?.trim() || "");
                    const matchLink = await matchCell.$eval("a", (el) => el.getAttribute("href") || "");

                    currentSection.matches.push({
                        time,
                        match: matchText,
                        url: matchLink
                    });
                }
            }
        }

        if (currentSection && currentSection.matches.length > 0) {
            previewLinks.push(currentSection);
        }

        // Log preview sections for debugging
        previewLinks.forEach((section) => {
            console.log(`\nSection: ${section.section}`);
            section.matches.forEach((match) => {
                console.log(`${match.time} - ${match.match}`);
            });
        });

        return previewLinks;
    } catch (error) {
        console.error("Error getting preview links:", error);
        return [];
    }
}

async function scrapeChampionshipPreviews(): Promise<void> {
    const browser = await BrowserService.getInstance();
    const page = await browser.newPage();

    try {
        console.log("Initializing browser...");

        // Before navigation, intercept and block AMP redirects
        await page.route("**/*amp**", (route) => route.abort());
        await page.route("**/*AMP**", (route) => route.abort());

        // Set desktop-specific headers
        await page.setExtraHTTPHeaders({
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-CH-UA-Mobile": "?0",
            "Sec-CH-UA-Platform": '"Windows"',
            DNT: "1",
        });

        // Championship teams for filtering
        const championshipTeams = [
            "norwich",
            "burnley",
            "sheffield united",
            "plymouth",
            "stoke",
            "cardiff",
            "watford",
            "west brom",
            "bristol city",
            "qpr",
            "coventry",
            "hull city",
            "preston",
            "leeds",
            "blackburn",
            "luton",
            "middlesbrough",
            "millwall",
            "oxford utd",
            "sheffield wednesday",
            "ipswich",
            "leicester",
            "southampton",
            "sunderland",
            "swansea",
            "birmingham",
            "huddersfield",
            "rotherham",
        ].map((team) => team.toLowerCase());

        console.log("Navigating to Championship section...");
        await navigateWithRetry(
            page,
            "https://www.sportsmole.co.uk/football/championship/"
        );

        // Wait for content to load
        await page.waitForSelector("body", { timeout: 30000 });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Extract first Championship preview link
        console.log("Finding first Championship preview link...");
        const previewLink = await page.evaluate((teams) => {
            const isChampionshipMatch = (text: string): boolean => {
                text = text.toLowerCase();
                return teams.some((team) => text.includes(team));
            };

            // Convert NodeList to Array for iteration
            const links = Array.from(document.querySelectorAll("a"));

            for (const link of links) {
                const href = link.getAttribute("href") || "";
                const text = link.textContent || "";

                if (
                    href.includes("/preview/") &&
                    href.includes("prediction-team-news-lineups") &&
                    isChampionshipMatch(text + " " + href)
                ) {
                    console.log(`Found Championship match: ${text}`);
                    return href.startsWith("/")
                        ? "https://www.sportsmole.co.uk" + href
                        : href;
                }
            }
            return null;
        }, championshipTeams);

        if (!previewLink) {
            console.log("❌ No Championship preview links found");
            return;
        }

        console.log(`\nProcessing preview: ${previewLink}`);

        // Process the single preview
        try {
            const preview = await scrapeMatchPreview(page, previewLink);
            if (preview && preview.homeTeam && preview.awayTeam) {
                const isChampionshipMatch = championshipTeams.some(
                    (team) =>
                        preview.homeTeam.toLowerCase().includes(team) ||
                        preview.awayTeam.toLowerCase().includes(team)
                );

                if (isChampionshipMatch) {
                    await sendToDiscord(preview);
                }
            }
        } catch (error) {
            console.error("Error processing preview", previewLink, error);
        }
    } catch (error) {
        console.error("Error fetching previews:", error);
    } finally {
        await page.close();
    }
}

async function getAnalysis(url: string): Promise<string | null> {
    const browser = await BrowserService.getInstance();
    const page = await browser.newPage();

    try {
        console.log("\n=== Getting Analysis ===");
        const analysisUrl = `${url}/analysis`;
        console.log("Analysis URL:", analysisUrl);

        console.log("🔄 Navigating to analysis page...");
        await navigateWithRetry(page, analysisUrl);
        console.log("✅ Navigation successful");

        console.log("⏳ Waiting for analysis content...");
        const analysis = await page.evaluate(() => {
            const analysisElement = document.querySelector(".article_content");
            if (!analysisElement) {
                console.log("⚠️ No analysis content found");
                return null;
            }
            const text = analysisElement.textContent?.trim();
            console.log(` Found analysis (${text?.length || 0} chars)`);
            return text || null;
        });

        return analysis;
    } catch (error) {
        console.error("\n❌ Error getting analysis:");
        console.error("Error details:", error);
        return null;
    } finally {
        console.log(" Closing analysis page...");
        await page.close();
        console.log("✅ Analysis page closed\n");
    }
}

function parseFormGuide(form: string[]): FormResult[] {
    return form.map((result) => {
        const parts = result.split(" ");
        const score = parts[0];
        const opponent = parts[1];
        const resultType = parts[2].replace(/[()]/g, "");
        return { score, opponent, result: resultType };
    });
}

function formatFormGuide(team: string, form: string[]): string {
    const results = parseFormGuide(form);
    const formattedResults = results.map(({ score, opponent, result }) => {
        const emoji = result === "W" ? "✅" : result === "L" ? "���" : "⚪";
        return `${emoji} ${score}-${opponent} (${result})`;
    });

    return `**${team}**\n${formattedResults.join("\n")}`;
}

// Fix the log interface at the top of the file
const log = {
    info: (msg: string, ...args: any[]) => console.log(`ℹ️  ${msg}`, ...args),
    success: (msg: string, ...args: any[]) => console.log(`✅ ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`❌ ${msg}`, ...args),
    warning: (msg: string, ...args: any[]) =>
        console.log(`⚠️  ${msg}`, ...args),
    section: (msg: string, ...args: any[]) =>
        console.log(`\n📌 ${msg}\n`, ...args),
    debug: (msg: string, ...args: any[]) =>
        process.env.DEBUG && console.log(`🔍 ${msg}`, ...args),
    browser: (msg: string) => {
        if (
            !msg.includes("ERR_BLOCKED_BY_CLIENT") &&
            !msg.includes("analytics") &&
            !msg.includes("CMP AppConsent") &&
            !msg.includes("startAA")
        ) {
            console.log(`🌐 ${msg}`);
        }
    },
};

// Add this new function to parse match statistics
function parseMatchStatistics(rawStats: string): MatchStats {
    const stats: MatchStats = {
        possession: { home: "0", away: "0" },
        shots: { home: "0", away: "0" },
        shotsOnTarget: { home: "0", away: "0" },
        corners: { home: "0", away: "0" },
        fouls: { home: "0", away: "0" },
        homeWinProbability: 0,
        drawProbability: 0,
        awayWinProbability: 0,
        trend: 0,
        drawTrend: 0,
        awayTrend: 0,
        bttsProbability: 0,
        bttsTrend: 0,
        over25Probability: 0,
        over25Trend: 0,
        over35Probability: 0,
        over35Trend: 0,
        homeOver05: 0,
        homeOver15: 0,
        awayOver05: 0,
        awayOver15: 0,
        scoreLines: []
    };

    try {
        // Parse main probabilities from the format "74.06% ( 3.5)"
        const mainProbRegex = /(\d+\.\d+)%\s*\(\s*[+-]?\d+\.\d+\)/g;
        const mainProbs = [...rawStats.matchAll(mainProbRegex)];

        if (mainProbs.length >= 3) {
            stats.homeWinProbability = parseFloat(mainProbs[0][1]);
            stats.drawProbability = parseFloat(mainProbs[1][1]);
            stats.awayWinProbability = parseFloat(mainProbs[2][1]);
        }

        // Parse BTTS
        const bttsMatch = rawStats.match(/Both teams to score (\d+\.\d+)%/);
        if (bttsMatch) {
            stats.bttsProbability = parseFloat(bttsMatch[1]);
        }

        // Parse Over 2.5
        const overMatch = rawStats.match(/Over 2\.5.*?(\d+\.\d+)%/);
        if (overMatch) {
            stats.over25Probability = parseFloat(overMatch[1]);
        }

        // Parse scorelines
        const scoreRegex = /(\d-\d)\s*@\s*(\d+\.\d+)%/g;
        let scoreMatch;
        while ((scoreMatch = scoreRegex.exec(rawStats)) !== null) {
            stats.scoreLines.push({
                score: scoreMatch[1],
                probability: parseFloat(scoreMatch[2]),
                trend: 0,
            });
        }

        // Sort scorelines by probability
        stats.scoreLines.sort((a, b) => b.probability - a.probability);
    } catch (error) {
        console.error("Error parsing match statistics:", error);
    }

    return stats;
}

// Add this function to create the stats embed
function createStatsEmbed(stats: MatchStats): DiscordEmbed[] {
    return [
        {
            title: "📊 Match Analysis - Result Probabilities",
            color: 0x00ff00,
            fields: [
                {
                    name: "Match Outcome",
                    value: [
                        `��� Home Win: ${stats.homeWinProbability.toFixed(1)}% (${stats.trend > 0 ? "+" : ""}${stats.trend.toFixed(2)})`,
                        `🤝 Draw: ${stats.drawProbability.toFixed(1)}% (${stats.drawTrend > 0 ? "+" : ""}${stats.drawTrend.toFixed(2)})`,
                        `✈️ Away Win: ${stats.awayWinProbability.toFixed(1)}% (${stats.awayTrend > 0 ? "+" : ""}${stats.awayTrend.toFixed(2)})`,
                    ].join("\n"),
                    inline: false,
                },
                {
                    name: "Goals Markets",
                    value: [
                        `��� Both Teams to Score: ${stats.bttsProbability.toFixed(1)}% (${stats.bttsTrend > 0 ? "+" : ""}${stats.bttsTrend.toFixed(2)})`,
                        `🎯 Over 2.5: ${stats.over25Probability.toFixed(1)}% (${stats.over25Trend > 0 ? "+" : ""}${stats.over25Trend.toFixed(2)})`,
                        `🎯 Under 2.5: ${(100 - stats.over25Probability).toFixed(1)}% (${-stats.over25Trend > 0 ? "+" : ""}${(-stats.over25Trend).toFixed(2)})`,
                        `🎯 Over 3.5: ${stats.over35Probability.toFixed(1)}% (${stats.over35Trend > 0 ? "+" : ""}${stats.over35Trend.toFixed(2)})`,
                        `🎯 Under 3.5: ${(100 - stats.over35Probability).toFixed(1)}% (${-stats.over35Trend > 0 ? "+" : ""}${(-stats.over35Trend).toFixed(2)})`,
                    ].join("\n"),
                    inline: false,
                },
            ],
        },
        {
            title: "📊 Match Analysis - Score Predictions",
            color: 0x00ff00,
            fields: [
                {
                    name: "Most Likely Scorelines",
                    value: stats.scoreLines
                        .map(
                            (score) =>
                                `${score.score}: ${score.probability.toFixed(1)}% (${score.trend > 0 ? "+" : ""}${score.trend.toFixed(2)})`
                        )
                        .join("\n"),
                    inline: false,
                },
                {
                    name: "Team Goals",
                    value: [
                        "Home Team:",
                        `Over 0.5: ${stats.homeOver05.toFixed(1)}%`,
                        `Over 1.5: ${stats.homeOver15.toFixed(1)}%`,
                        "\nAway Team:",
                        `Over 0.5: ${stats.awayOver05.toFixed(1)}%`,
                        `Over 1.5: ${stats.awayOver15.toFixed(1)}%`,
                    ].join("\n"),
                    inline: false,
                },
            ],
        },
    ];
}

// Modify the createDiscordEmbeds function to include the new stats embed
async function createDiscordEmbeds(
    preview: MatchPreview
): Promise<DiscordEmbed[]> {
    const embeds: DiscordEmbed[] = [];
    const MAX_DESCRIPTION_LENGTH = 4000;

    // Helper function to truncate text
    const truncateText = (text: string, maxLength: number): string => {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + "...";
    };

    // First embed - Match Overview and Key Status
    embeds.push({
        title: `${preview.homeTeam} vs ${preview.awayTeam}`,
        description: preview.keyAbsences || preview.matchSummary,
        color: 0x3498db,
    });

    // Second embed - Team News
    if (preview.teamNews?.home?.length || preview.teamNews?.away?.length) {
        embeds.push({
            title: "Team News",
            color: 0x2ecc71,
            fields: [
                {
                    name: "Home Team",
                    value: preview.teamNews?.home?.length
                        ? preview.teamNews.home
                            .map((news) => `• ${news}`)
                            .join("\n")
                        : "No team news available",
                    inline: true,
                },
                {
                    name: "Away Team",
                    value: preview.teamNews?.away?.length
                        ? preview.teamNews.away
                            .map((news) => `• ${news}`)
                            .join("\n")
                        : "No team news available",
                    inline: true,
                },
            ],
        });
    }

    // Third embed - Prediction
    if (preview.prediction) {
        const predictionText = preview.prediction.replace("We say: ", "");
        embeds.push({
            title: "Sports Mole Prediction",
            description: predictionText,
            color: 0x9b59b6,
        });
    }

    // Fourth embed - Match Analysis (if available)
    if (preview.statistics) {
        const stats = preview.statistics.split("\n").filter(Boolean);

        // Parse probabilities
        const resultProbs =
            stats
                .find((s) => s.includes("%"))
                ?.split(" ")
                .filter((s) => s.includes("%")) || [];
        const bttsProb =
            stats
                .find((s) => s.toLowerCase().includes("both teams to score"))
                ?.match(/\d+\.\d+%/)?.[0] || "";
        const scoreLines = stats
            .filter((s) => s.includes("@"))
            .map((s) => {
                const [score, prob] = s.split("@").map((p) => p.trim());
                return `${score}: ${prob}`;
            });

        const analysisEmbed: DiscordEmbed = {
            title: "Match Analysis",
            color: 0x00ff00,
            fields: [],
        };

        // Add result probabilities
        if (resultProbs.length >= 3) {
            analysisEmbed.fields?.push({
                name: "Match Result",
                value: [
                    `Home Win: ${resultProbs[0]}`,
                    `Draw: ${resultProbs[1]}`,
                    `Away Win: ${resultProbs[2]}`,
                ].join("\n"),
                inline: false,
            });
        }

        // Add BTTS probability
        if (bttsProb) {
            analysisEmbed.fields?.push({
                name: "Both Teams to Score",
                value: `Yes: ${bttsProb}\nNo: ${(100 - parseFloat(bttsProb)).toFixed(2)}%`,
                inline: false,
            });
        }

        // Add scorelines
        if (scoreLines.length > 0) {
            analysisEmbed.fields?.push({
                name: "Most Likely Scorelines",
                value: scoreLines.slice(0, 5).join("\n"),
                inline: false,
            });
        }

        embeds.push(analysisEmbed);
    }

    return embeds;
}

async function sendToDiscord(preview: MatchPreview): Promise<void> {
    try {
        const structuredMessage = await createStructuredPreview(preview);

        // Create the webhook message
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            throw new Error(
                "Discord webhook URL not found in environment variables"
            );
        }

        // Send the structured message
        const response = await axios.post(webhookUrl, {
            content: structuredMessage,
            username: "Match Preview Bot",
            avatar_url: "https://i.imgur.com/4M34hi2.png", // Add a relevant avatar URL
        });

        log.success(
            `Successfully sent preview for ${preview.homeTeam} vs ${preview.awayTeam}`
        );
    } catch (error) {
        log.error(`Failed to send preview: ${(error as Error).message}`);
        throw error;
    }
}

async function summarizeWithOllama(text: string): Promise<string> {
    try {
        // Implementation here - for now just return the text
        return text;
    } catch (error) {
        console.error("Error summarizing with Ollama:", error);
        return text;
    }
}

function formatMatchProbabilities(stats: string): string {
    try {
        // Implementation here - for now just return the stats
        return stats;
    } catch (error) {
        console.error("Error formatting match probabilities:", error);
        return stats;
    }
}

async function processMatchPreview(preview: MatchPreview): Promise<DiscordMessage> {
    try {
        let summarizedContent = "";
        let probabilities = "";

        if (preview.fullArticle) {
            summarizedContent = await summarizeWithOllama(preview.fullArticle);
        }

        if (preview.statistics) {
            probabilities = formatMatchProbabilities(preview.statistics);
        }

        return formatMatchPreview(preview);
    } catch (error) {
        console.error("Error processing match preview:", error);
        throw error;
    }
}

export async function scrapeMatchPreview(page: Page, url: string): Promise<MatchPreview | null> {
    try {
        console.log("Starting to scrape preview:", url);

        const maxRetries = 3;
        let retryCount = 0;
        let success = false;

        while (retryCount < maxRetries && !success) {
            try {
                await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });
                success = true;
            } catch (error) {
                console.log(`Navigation attempt ${retryCount + 1} failed:`, error);
                retryCount++;
                if (retryCount === maxRetries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        const extractedData = await page.evaluate(() => {
            const titleParts = document.title.split(" - ")[0].split(" vs. ");
            const content = document.querySelector(".article_content");

            if (!content) return null;

            return {
                title: document.title,
                homeTeam: titleParts[0] || "",
                awayTeam: (titleParts[1] || "").split(" - ")[0] || "",
                content: content.textContent || "",
                html: content.innerHTML || "",
                competition: document.querySelector(".competition")?.textContent?.trim() || "",
                venue: document.querySelector(".venue")?.textContent?.trim() || "",
                kickoff: document.querySelector(".kickoff")?.textContent?.trim() || "",
                referee: document.querySelector(".referee")?.textContent?.trim() || "",
            };
        });

        if (!extractedData) {
            console.log("❌ Failed to extract data from page");
            return null;
        }

        return {
            url,
            homeTeam: extractedData.homeTeam,
            awayTeam: extractedData.awayTeam,
            matchSummary: extractedData.content,
            fullArticle: extractedData.html,
            prediction: "",
            statistics: "",
            probabilities: "",
            competition: extractedData.competition,
            venue: extractedData.venue,
            kickoff: extractedData.kickoff,
            referee: extractedData.referee,
            overview: "",
            teamNews: {
                home: [],
                away: []
            },
            lineups: {
                home: [],
                away: []
            },
            formGuide: {
                home: [],
                away: []
            }
        };

    } catch (error) {
        console.error("Error scraping match preview:", error);
        return null;
    }
}

async function initBrowser() {
    const browser = await BrowserService.getInstance();
    const page = await browser.newPage();

    // Set proper headers
    await page.setExtraHTTPHeaders({
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        "Upgrade-Insecure-Requests": "1",
    });

    // Add route handler to block AMP
    await page.route("**/*", async (route: Route) => {
        const url = route.request().url();

        // Block AMP and related resources
        if (
            url.includes("cdn.ampproject.org") ||
            url.includes("/amp/") ||
            url.includes("amp=1") ||
            url.includes("amp_latest") ||
            url.includes("amp-latest")
        ) {
            await route.abort();
            return;
        }

        // Modify requests to ensure non-AMP versions
        if (url.includes("sportsmole.co.uk")) {
            const newUrl = url
                .replace("/amp/", "/")
                .replace("?amp=1", "")
                .replace("&amp=1", "");
            if (newUrl !== url) {
                await route.continue({ url: newUrl });
                return;
            }
        }

        await route.continue();
    });

    // Add console handler for debugging
    page.on("console", (msg: ConsoleMessage) => {
        if (msg.text().includes("AMP") || msg.text().includes("amp")) {
            console.log("❌ AMP detected:", msg.text());
        }
    });

    return page;
}

async function main() {
    try {
        log.section("Starting main process...");

        // Wait for bot to be ready
        await new Promise<void>((resolve) => {
            if (bot.client.isReady()) {
                resolve();
            } else {
                bot.client.once("ready", () => resolve());
            }
        });

        log.info("Initializing browser...");
        const browserService = await BrowserService.getInstance();
        const page = await initBrowser();

        // More aggressive AMP blocking
        log.info("Setting up request blocking...");
        await page.route("**/*", async (route) => {
            const url = route.request().url();
            const resourceType = route.request().resourceType();

            // Log URL being requested (for debugging)
            log.debug(`Request: ${resourceType} - ${url}`);

            // Block AMP and unnecessary resources
            if (
                url.includes("amp") ||
                url.includes("AMP") ||
                url.includes("lightning") ||
                url.includes("google-analytics") ||
                url.includes("facebook") ||
                url.includes("prebid") ||
                url.includes("pixel.gif") ||
                url.includes("cloudfront.net") ||
                url.includes("appconsent.io") ||
                url.includes("wonderpush") ||
                url.includes("imgix.net")
            ) {
                log.debug(`Blocking: ${url}`);
                await route.abort();
            } else {
                await route.continue({
                    headers: {
                        ...route.request().headers(),
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Sec-CH-UA-Mobile": "?0",
                        "Sec-CH-UA-Platform": '"Windows"',
                        DNT: "1",
                    },
                });
            }
        });

        log.info("Navigating to previews page...");
        await page.goto("https://www.sportsmole.co.uk/football/preview/", {
            waitUntil: "networkidle",
            timeout: 30000,
        });

        // Check if we got AMP version
        const isAmp = await page.evaluate(() => {
            return (
                document.documentElement.hasAttribute("amp") ||
                document.documentElement.hasAttribute("⚡")
            );
        });

        if (isAmp) {
            log.error("Still getting AMP version despite blocking!");
            throw new Error("Failed to prevent AMP redirect");
        }

        log.success("Successfully loaded non-AMP page");

        // Get preview links
        log.info("Getting preview links...");
        const previewLinks = await getPreviewLinks(page);
        log.info(`Found ${previewLinks.length} preview sections`);

        // Process each preview
        for (const section of previewLinks) {
            log.section(`Processing section: ${section.section}`);

            for (const match of section.matches) {
                log.info(`Processing match: ${match.match}`);
                try {
                    const preview = await scrapeMatchPreview(page, match.url);
                    if (preview) {
                        log.success(`Successfully processed ${match.match}`);
                        await sendToDiscord(preview);
                    } else {
                        log.error(`Failed to extract data for ${match.match}`);
                    }
                } catch (error) {
                    log.error(`Error processing ${match.match}: ${error}`);
                }

                // Add delay between matches
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        log.section("Cleanup");
        await page.close();
        await browserService.close();
        log.success("Process completed successfully");
    } catch (error) {
        log.error("Fatal error in main process:", error);
    } finally {
        log.info("Script execution finished");
        process.exit(0);
    }
}

// Run the main function when the script is executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}

async function formatMatchPreview(preview: MatchPreview): Promise<DiscordMessage> {
    let content = "";
    let probabilities = "";

    // Get summarized content using Ollama if available
    if (preview.fullArticle) {
        content = await summarizeWithOllama(preview.fullArticle);
    }

    // Format probabilities if available
    if (preview.statistics) {
        probabilities = formatMatchProbabilities(preview.statistics);
    }

    // Create the embed
    return {
        embeds: [
            {
                title: `${preview.homeTeam} vs ${preview.awayTeam}`,
                description: preview.keyAbsences || preview.matchSummary || "",
                color: 0x3498db,
                url: preview.url,
                fields: [
                    {
                        name: "Competition",
                        value: preview.competition || "Unknown",
                        inline: true,
                    },
                    {
                        name: "Venue",
                        value: preview.venue || "Unknown",
                        inline: true,
                    },
                    {
                        name: "Kickoff",
                        value: preview.kickoff || "Unknown",
                        inline: true,
                    },
                    ...(preview.referee ? [{
                        name: "Referee",
                        value: preview.referee,
                        inline: true,
                    }] : []),
                    ...(preview.formGuide?.home?.length ? [{
                        name: `${preview.homeTeam} Form`,
                        value: preview.formGuide.home.join(", "),
                        inline: true,
                    }] : []),
                    ...(preview.formGuide?.away?.length ? [{
                        name: `${preview.awayTeam} Form`,
                        value: preview.formGuide.away.join(", "),
                        inline: true,
                    }] : [])
                ]
            }
        ]
    };
}

async function getCachedPreview(url: string): Promise<MatchPreview | null> {
    const now = Date.now();
    const cached = articleCache.get(url);

    if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    // Create a new page for scraping
    const browser = await BrowserService.getInstance();
    const page = await browser.newPage();

    try {
        const preview = await scrapeMatchPreview(page, url);
        articleCache.set(url, {
            data: preview,
            timestamp: now,
        });

        return preview;
    } finally {
        await page.close();
    }
}

async function getFormGuide(url: string): Promise<FormData | null> {
    const browser = await BrowserService.getInstance();
    const page = await browser.newPage();

    try {
        await page.setDefaultNavigationTimeout(30000);
        await page.setDefaultTimeout(30000);

        const success = await navigateWithRetry(page, url);
        if (!success) {
            return null;
        }

        // Extract form guide data
        const formData = await page.evaluate(() => {
            const getFormResults = (selector: string): string[] => {
                const elements = document.querySelectorAll(selector);
                return Array.from(elements).map(
                    (el) => el.textContent?.trim() || ""
                );
            };

            return {
                home: getFormResults(".home-team-form .result"),
                away: getFormResults(".away-team-form .result")
            } as FormData;
        });

        return formData;
    } catch (error) {
        console.error("Error getting form guide:", error);
        return null;
    } finally {
        await browser.close();
    }
}

async function getDataAnalysisUrl(page: Page): Promise<string | null> {
    try {
        const dataAnalysisLink = await page.evaluate(() => {
            const link = document.querySelector('a[title="Data Analysis"]');
            return link ? link.getAttribute("href") : null;
        });

        if (dataAnalysisLink) {
            return dataAnalysisLink.startsWith("http")
                ? dataAnalysisLink
                : `https://www.sportsmole.co.uk${dataAnalysisLink}`;
        }
        return null;
    } catch (error) {
        console.error("Error getting data analysis URL:", error);
        return null;
    }
}

async function scrapeDataAnalysis(
    page: Page,
    url: string
): Promise<MatchAnalysisData | null> {
    try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

        const analysisData = await page.evaluate(() => {
            // Helper function to clean probability text
            const cleanProb = (text: string) =>
                text.trim().replace(/[^\d.]/g, "");

            // Get probabilities from the page
            const probabilities = Array.from(
                document.querySelectorAll(".probability")
            ).map((el) => el.textContent?.trim() || "");

            // Get scoreline predictions
            const scorelines = Array.from(
                document.querySelectorAll(".scoreline")
            )
                .map((el) => ({
                    score:
                        el.querySelector(".score")?.textContent?.trim() || "",
                    probability:
                        el.querySelector(".prob")?.textContent?.trim() || "",
                }))
                .filter((s) => s.score && s.probability);

            return {
                homeWinProb: probabilities[0] || "",
                drawProb: probabilities[1] || "",
                awayWinProb: probabilities[2] || "",
                bttsProb: probabilities[3] || "",
                over25Prob: probabilities[4] || "",
                scorelinePredictions: scorelines,
            };
        });

        return analysisData;
    } catch (error) {
        console.error("Error scraping data analysis:", error);
        return null;
    }
}

// Add new interface for match analysis data
interface MatchAnalysisData {
    homeWinProb: string;
    drawProb: string;
    awayWinProb: string;
    bttsProb: string;
    over25Prob: string;
    scorelinePredictions: Array<{ score: string; probability: string }>;
    dataAnalysisUrl?: string;
}

async function createStructuredPreview(preview: MatchPreview): Promise<string> {
    let content = "";
    let probabilities = "";

    // Get summarized content using Ollama if available
    if (preview.fullArticle) {
        content = await summarizeWithOllama(preview.fullArticle);
    }

    // Format probabilities if available
    if (preview.statistics) {
        probabilities = formatMatchProbabilities(preview.statistics);
    }

    // Combine everything into a structured message
    return `${preview.homeTeam} vs ${preview.awayTeam}

${content}

${probabilities}

${preview.prediction ? `Sports Mole Prediction:\n${preview.prediction}` : ""}`;
}
