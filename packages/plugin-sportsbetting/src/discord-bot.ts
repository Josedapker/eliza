import {
    ButtonInteraction,
    ChannelType,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    TextChannel,
} from "discord.js";

import { BrowserService } from "./services/browser";
import { scrapeMatchPreview } from "./standalone-test";
import { MatchPreview, PreviewMatch, PreviewSection } from "./types";

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

        // Set bot username to Liga when ready
        this.client.once("ready", async () => {
            try {
                await this.client.user?.setUsername("Liga");
                console.log(`Bot logged in as ${this.client.user?.tag}`);
            } catch (error) {
                console.error("Failed to set username:", error);
            }
        });

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
    ): Promise<void> {
        try {
            console.log("\n=== Starting Discord Message Process ===");

            const channelId = process.env.DISCORD_CHANNEL_ID;
            if (!channelId) {
                console.error(
                    "❌ No Discord channel ID provided in environment variables"
                );
                return;
            }
            console.log("✓ Found channel ID:", channelId);

            const channel = await this.getChannel(channelId);
            if (!channel) {
                console.error("❌ Could not find Discord channel");
                return;
            }
            console.log("✓ Successfully connected to Discord channel");

            // Build the main message content
            console.log("\n--- Building Main Message ---");
            const dateString = new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
            });

            let mainContent = `**Today's Match Previews**\n\n${dateString}\n\n`;
            console.log("✓ Added date:", dateString);

            // Add each competition and its matches
            for (const section of sections) {
                console.log(`\nProcessing section: ${section.section}`);
                mainContent += `**${section.section}**\n`;
                for (const match of section.matches) {
                    console.log(
                        `- Adding match: ${match.match} at ${match.time}`
                    );
                    mainContent += `⚽ ${match.time} ${match.match}\n`;
                }
                mainContent += "\n";
            }

            // Send the main message
            console.log("\n--- Sending Main Message ---");
            const mainMessage = await channel.send({
                content: mainContent.trim(),
            });
            console.log("✓ Main message sent successfully");

            // Create threads for each competition section
            console.log("\n=== Creating Competition Threads ===");
            for (const section of sections) {
                try {
                    console.log(`\n--- Processing ${section.section} ---`);

                    // Create thread for this competition
                    console.log(`Creating thread for: ${section.section}`);
                    const thread = await mainMessage.startThread({
                        name: `${section.section} Previews`,
                        autoArchiveDuration: 1440, // 24 hours
                    });
                    console.log("✓ Thread created successfully");

                    // Process each match in the section
                    for (const match of section.matches) {
                        console.log(`\nProcessing match: ${match.match}`);
                        const preview = previews.get(
                            `${section.section}_${match.match}`
                        );

                        if (!preview) {
                            console.log(
                                `❌ No preview found for ${match.match}`
                            );
                            continue;
                        }
                        console.log("✓ Found preview data");

                        // Send the match image if available
                        if (preview.imageUrl) {
                            console.log("Sending match image");
                            await thread.send({ files: [preview.imageUrl] });
                            console.log("✓ Image sent");
                        }

                        // Format match overview
                        console.log("Formatting match content");
                        let matchContent = [
                            `**${preview.homeTeam} vs ${preview.awayTeam}**\n`,
                            preview.competition
                                ? `**Competition**: ${preview.competition}`
                                : null,
                            preview.venue
                                ? `**Venue**: ${preview.venue}`
                                : null,
                            preview.kickoff
                                ? `**Kickoff**: ${preview.kickoff}`
                                : null,
                            "",
                            "**Match Context**",
                            preview.matchSummary ||
                                "No match context available",
                            "",
                            preview.keyAbsences
                                ? `**Key Absences**\n${preview.keyAbsences}`
                                : null,
                            "",
                            "**Team News**",
                            `**${preview.homeTeam}**:`,
                            preview.teamNews?.home?.length
                                ? preview.teamNews.home
                                      .map((news) => `• ${news}`)
                                      .join("\n")
                                : "No team news available",
                            "",
                            `**${preview.awayTeam}**:`,
                            preview.teamNews?.away?.length
                                ? preview.teamNews.away
                                      .map((news) => `• ${news}`)
                                      .join("\n")
                                : "No team news available",
                            "",
                            preview.prediction
                                ? "**Sports Mole Prediction**"
                                : null,
                            preview.prediction || null,
                            "",
                            preview.dataAnalysisUrl
                                ? `[Click here for detailed match analysis](${preview.dataAnalysisUrl})`
                                : null,
                        ]
                            .filter(Boolean)
                            .join("\n");

                        // Send the match details
                        console.log("Sending match details to thread");
                        await thread.send(matchContent);
                        console.log("✓ Match details sent successfully");
                    }
                } catch (error) {
                    console.error(
                        `❌ Error creating thread for ${section.section}:`,
                        error
                    );
                }
            }

            console.log("\n=== Discord Message Process Complete ===\n");
        } catch (error) {
            console.error("❌ Error in sendMatchOverview:", error);
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
