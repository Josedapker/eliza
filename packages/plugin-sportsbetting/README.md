# Champions League Match Preview Scraper

This tool scrapes and aggregates Champions League match previews from SportsMole and can send them to Discord.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
# Create a .env file with:
DISCORD_WEBHOOK_URL=your_webhook_url_here
```

## Features

- Scrapes Champions League match previews
- Caches data for 1 hour to avoid unnecessary requests
- Sends formatted previews to Discord with:
  - Match date and time
  - Team news highlights
  - Links to full previews and team news
  - Beautiful formatting with emojis

## Usage

```bash
pnpm test
```

This will:
1. Check for cached match data (less than 1 hour old)
2. If no cache exists, fetch fresh data from SportsMole
3. Save the data to a JSON file
4. Send formatted previews to Discord (if webhook URL is configured)

## Data Storage

Match previews are stored in `data/match_previews_YYYY-MM-DD.json` with the following structure:
```typescript
{
  matches: MatchPreview[];
  timestamp: string;
  total: number;
}
```
