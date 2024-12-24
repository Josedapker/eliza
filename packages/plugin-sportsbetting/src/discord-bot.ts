import {
    ButtonInteraction,
    ChannelType,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    TextChannel,
} from 'discord.js';

import { BrowserService } from './services/browser';
import { scrapeMatchPreview } from './standalone-test';
import {
    MatchPreview,
    PreviewMatch,
    PreviewSection,
} from './types';

export class DiscordBot {
    public client: Client;
    private previewCache: Map<string, MatchPreview> = new Map();
    private applicationId: string;
    private sections: PreviewSection[] = [];

    constructor(token: string) {
        this.applicationId = process.env.DISCORD_APPLICATION_ID || "";
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.setupEventHandlers();
        this.client.login(token);
    }

    private setupEventHandlers() {
        this.client.on("ready", () => {
            console.log(`Bot logged in as ${this.client.user?.tag}`);
        });

        this.client.on("interactionCreate", async (interaction) => {
            if (!interaction.isButton()) return;

            const [action] = interaction.customId.split("_");
            if (action === "load") {
                await this.handleButtonClick(interaction);
            }
        });
    }

    private async handlePreviewButton(
        interaction: ButtonInteraction,
        sectionName: string,
        matchIndex: number
    ) {
        await interaction.deferReply({ ephemeral: true });
        const [_, section, idx, previewType] = interaction.customId.split("_");

        try {
            const match = this.sections.find((s) => s.section === section)
                ?.matches[matchIndex];

            if (!match) {
                await interaction.editReply("Match not found");
                return;
            }

            // Create browser instance outside the preview check
            const browserService = await BrowserService.getInstance();
            const page = await browserService.newPage();

            try {
                const preview = await scrapeMatchPreview(page, match.url);
                if (preview) {
                    this.previewCache.set(`${section}_${idx}`, preview);
                    const embed = this.createPreviewEmbed(
                        match,
                        preview,
                        previewType
                    );
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply("Could not load match preview");
                }
            } finally {
                await browserService.close();
            }
        } catch (error) {
            console.error("Error fetching preview:", error);
            await interaction.editReply("Error loading match preview");
        }
    }

    private createPreviewEmbed(
        match: PreviewMatch,
        preview: MatchPreview,
        previewType: string
    ): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`${match.time} - ${match.match}`)
            .setURL(match.url)
            .addFields([
                {
                    name: "📝 Match Summary",
                    value:
                        preview.matchSummary?.substring(0, 1024) ||
                        "No summary available",
                    inline: false,
                },
                {
                    name: `👥 ${preview.homeTeam} Team News`,
                    value:
                        preview.teamNews?.home?.join("\n").substring(0, 1024) ||
                        "No team news available",
                    inline: false,
                },
                {
                    name: `👥 ${preview.awayTeam} Team News`,
                    value:
                        preview.teamNews?.away?.join("\n").substring(0, 1024) ||
                        "No team news available",
                    inline: false,
                },
                {
                    name: `📊 Form Guide`,
                    value: [
                        `${preview.homeTeam}: ${preview.formGuide?.home?.join(", ") || "No data"}`,
                        `${preview.awayTeam}: ${preview.formGuide?.away?.join(", ") || "No data"}`,
                    ].join("\n"),
                    inline: false,
                },
                {
                    name: "🎯 Prediction",
                    value: preview.prediction || "No prediction available",
                    inline: false,
                },
                {
                    name: "🔗 Quick Links",
                    value: `[View Full Preview on Sports Mole](${match.url})`,
                    inline: false,
                },
            ])
            .setTimestamp();

        return embed;
    }

    public async sendMatchOverview(
        sections: PreviewSection[],
        previews: Map<string, MatchPreview>
    ) {
        try {
            const channelId = process.env.DISCORD_CHANNEL_ID;
            if (!channelId) {
                console.error("No channel ID provided");
                return;
            }

            // Hard-coded example date to match your screenshots.
            // You can replace this with a dynamic date library if you prefer.
            const dateString = "Sunday, December 22, 2024";

            const channel = await this.getChannel(channelId);
            if (!channel) {
                console.error("Could not find channel");
                return;
            }

            console.log('Received sections:', JSON.stringify(sections, null, 2));
            console.log('Received previews:', Array.from(previews.entries()));

            // Build the summary content with the desired heading and date
            const summaryContent =
                `**Today's Available Match Previews**\n\n${dateString}\n\n` +
                sections
                    .map(section => {
                        console.log(`Processing section: ${section.section}`);
                        console.log(`Matches in section:`, section.matches);

                        return `**${section.section}**\n` +
                            section.matches.map(match => {
                                console.log(`Processing match:`, match);
                                // Format each match line with a soccer-ball icon and "EST" after the time
                                return `⚽ ${match.time} EST ${match.match}`;
                            }).join('\n');
                    })
                    .join('\n\n');

            console.log('Final summary content:', summaryContent);

            // Send the main "today's previews" message
            const summaryMessage = await channel.send({
                content: summaryContent
            });

            // Process each match in parallel
            const threadPromises = sections.flatMap(section =>
                section.matches.map(async (match, index) => {
                    try {
                        console.log(`Creating thread for match: ${match.match}`);
                        // Create a thread for this match
                        const thread = await summaryMessage.startThread({
                            name: match.match,
                            autoArchiveDuration: 1440 // Archive after 24 hours
                        });

                        const preview = previews.get(`${section.section}_${index}`);
                        console.log(`Preview data for ${match.match}:`, preview);

                        if (!preview) {
                            await thread.send("Preview data not available for this match.");
                            return;
                        }

                        // Send match context
                        const contextMessage = [
                            "**📊 Match Context**",
                            preview.competition ? `• Competition: ${preview.competition}` : null,
                            preview.venue ? `• Venue: ${preview.venue}` : null,
                            preview.matchSummary ? `• Context: ${preview.matchSummary}` : null
                        ].filter(Boolean).join('\n');
                        await thread.send(contextMessage);

                        // Send key information
                        if (preview.keyAbsences || preview.overview) {
                            const keyInfoMessage = [
                                "**ℹ️ Key Information**",
                                preview.keyAbsences ? `• ${preview.keyAbsences}` : null,
                                preview.overview ? `• ${preview.overview}` : null
                            ].filter(Boolean).join('\n');
                            await thread.send(keyInfoMessage);
                        }

                        // Send team news
                        const teamNewsMessage = [
                            "**👥 Team News**",
                            `**${preview.homeTeam}:**`,
                            preview.teamNews?.home?.length
                                ? preview.teamNews.home.map(news => `• ${news}`).join('\n')
                                : "No team news available",
                            "",
                            `**${preview.awayTeam}:**`,
                            preview.teamNews?.away?.length
                                ? preview.teamNews.away.map(news => `• ${news}`).join('\n')
                                : "No team news available"
                        ].join('\n');
                        await thread.send(teamNewsMessage);

                        // Send prediction
                        if (preview.prediction) {
                            await thread.send(`**🎯 Prediction**\n${preview.prediction}`);
                        }

                    } catch (error) {
                        console.error(`Error creating thread for match ${match.match}:`, error);
                    }
                })
            );

            // Wait for all threads to be created and populated
            await Promise.allSettled(threadPromises);

        } catch (error) {
            console.error("Error in sendMatchOverview:", error);
        }
    }

    private splitMessage(content: string, maxLength: number = 2000): string[] {
        if (content.length <= maxLength) return [content];

        const chunks: string[] = [];
        let currentChunk = "";

        const lines = content.split("\n");
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxLength) {
                chunks.push(currentChunk);
                currentChunk = line + "\n";
            } else {
                currentChunk += line + "\n";
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    private async handleButtonClick(interaction: ButtonInteraction) {
        await interaction.deferReply({ ephemeral: false });

        const [action, dataType, ...urlParts] = interaction.customId.split("_");
        const url = urlParts.join("_");

        try {
            const browserService = await BrowserService.getInstance();
            const page = await browserService.newPage();

            try {
                const preview = await scrapeMatchPreview(page, url);
                if (!preview) {
                    await interaction.editReply("Could not load match data");
                    return;
                }

                // Initialize embed with common properties
                const embed = new EmbedBuilder().setColor(0x3498db).setURL(url);

                // Add specific content based on button type
                switch (dataType) {
                    case "summary":
                        embed
                            .setTitle("📝 Match Summary")
                            .setDescription(
                                preview.matchSummary || "No summary available"
                            );
                        break;

                    case "team_news":
                        embed.setTitle("👥 Team News").addFields([
                            {
                                name: preview.homeTeam,
                                value:
                                    preview.teamNews?.home?.join("\n") ||
                                    "No team news available",
                                inline: false,
                            },
                            {
                                name: preview.awayTeam,
                                value:
                                    preview.teamNews?.away?.join("\n") ||
                                    "No team news available",
                                inline: false,
                            },
                        ]);
                        break;

                    case "prediction":
                        embed
                            .setTitle("🎯 Sports Mole Prediction")
                            .setDescription(
                                preview.prediction || "No prediction available"
                            );
                        break;

                    case "form":
                        embed.setTitle("📊 Form Guide").addFields([
                            {
                                name: preview.homeTeam,
                                value:
                                    preview.formGuide?.home?.join(", ") ||
                                    "No data",
                                inline: true,
                            },
                            {
                                name: preview.awayTeam,
                                value:
                                    preview.formGuide?.away?.join(", ") ||
                                    "No data",
                                inline: true,
                            },
                        ]);
                        break;

                    default:
                        await interaction.editReply("Invalid button type");
                        return;
                }

                await interaction.editReply({ embeds: [embed] });
            } finally {
                await browserService.close();
            }
        } catch (error) {
            console.error("Error handling button click:", error);
            await interaction.editReply("Error loading data");
        }
    }

    private async getDefaultChannel(): Promise<TextChannel | null> {
        const channel = this.client.channels.cache.find(
            (channel) => channel.type === ChannelType.GuildText
        );
        return channel as TextChannel;
    }

    public async getChannel(channelId: string): Promise<TextChannel | null> {
        await this.waitForReady();
        return this.client.channels.cache.get(channelId) as TextChannel;
    }

    private async waitForReady(): Promise<void> {
        if (this.client.isReady()) return;

        return new Promise((resolve) => {
            this.client.once("ready", () => resolve());
        });
    }
}
