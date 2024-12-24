import { Action, ActionContext } from "@ai16z/eliza";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { Cache } from "../utils/cache";

export interface GetDataParams {
    league?: string;
    team?: string;
    matchId?: string;
    dateFrom?: string;
    dateTo?: string;
    maxRetries?: number;
    cacheTimeout?: number; // in milliseconds
}

export interface MatchPreview {
    title: string;
    date: string;
    homeTeam: string;
    awayTeam: string;
    venue: string;
    kickoff: string;
    headToHead: string[];
    prediction: string;
    league?: string;
    odds?: {
        home: string;
        draw: string;
        away: string;
    };
}

async function retry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delay: number = 1000
): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            if (attempt === maxRetries) break;
            
            console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError || new Error('All retry attempts failed');
}

export const getDataAction: Action<GetDataParams, MatchPreview[]> = {
    name: "getData",
    description: "Fetches football match previews and odds from SportsMole",
    
    async execute(context: ActionContext, params: GetDataParams): Promise<MatchPreview[]> {
        const cache = Cache.getInstance();
        const cacheKey = `sportsmole-${JSON.stringify(params)}`;
        const cachedData = await cache.get<MatchPreview[]>(cacheKey);
        
        if (cachedData) {
            return cachedData;
        }
        
        const maxRetries = params.maxRetries || 3;
        const cacheTimeout = params.cacheTimeout || 15 * 60 * 1000; // 15 minutes default
        
        return await retry(async () => {
            const browser = await chromium.launch();
            const page = await browser.newPage();
            
            try {
                // Build the URL with filters
                let url = "https://www.sportsmole.co.uk/football/preview/";
                if (params.league) {
                    url += `${params.league}/`;
                }
                
                await page.goto(url);
                await page.waitForLoadState("networkidle");
                
                const content = await page.content();
                const $ = cheerio.load(content);
                
                const previews: MatchPreview[] = [];
                
                // Parse the preview articles
                $("article.preview").each((_, element) => {
                    const $article = $(element);
                    
                    const preview: MatchPreview = {
                        title: $article.find("h3").text().trim(),
                        date: $article.find(".date").text().trim(),
                        homeTeam: $article.find(".home-team").text().trim(),
                        awayTeam: $article.find(".away-team").text().trim(),
                        venue: $article.find(".venue").text().trim(),
                        kickoff: $article.find(".kickoff").text().trim(),
                        headToHead: [],
                        prediction: $article.find(".prediction").text().trim(),
                        league: $article.find(".league").text().trim(),
                    };
                    
                    // Filter by team if specified
                    if (params.team && 
                        !preview.homeTeam.toLowerCase().includes(params.team.toLowerCase()) &&
                        !preview.awayTeam.toLowerCase().includes(params.team.toLowerCase())) {
                        return;
                    }
                    
                    // Filter by date range if specified
                    if (params.dateFrom || params.dateTo) {
                        const matchDate = new Date(preview.date);
                        if (params.dateFrom && matchDate < new Date(params.dateFrom)) return;
                        if (params.dateTo && matchDate > new Date(params.dateTo)) return;
                    }
                    
                    // Extract head-to-head information
                    $article.find(".head-to-head li").each((_, h2h) => {
                        preview.headToHead.push($(h2h).text().trim());
                    });
                    
                    // Extract odds if available
                    const oddsElement = $article.find(".odds");
                    if (oddsElement.length > 0) {
                        preview.odds = {
                            home: oddsElement.find(".home-odds").text().trim(),
                            draw: oddsElement.find(".draw-odds").text().trim(),
                            away: oddsElement.find(".away-odds").text().trim(),
                        };
                    }
                    
                    previews.push(preview);
                });
                
                // Cache the results
                await cache.set(cacheKey, previews, cacheTimeout);
                
                return previews;
                
            } catch (error) {
                console.error("Error fetching match previews:", error);
                throw error;
            } finally {
                await browser.close();
            }
        }, maxRetries);
    }
};
