import { getDataAction } from './actions/getData';

async function test() {
    try {
        // Test 1: Get Premier League matches
        console.log('Testing Premier League matches...');
        const plMatches = await getDataAction.execute({} as any, {
            league: 'premier-league',
            maxRetries: 3,
        });
        console.log(`Found ${plMatches.length} Premier League matches`);
        console.log('Sample match:', JSON.stringify(plMatches[0], null, 2));

        // Test 2: Filter by team
        console.log('\nTesting team filter...');
        const teamMatches = await getDataAction.execute({} as any, {
            team: 'Arsenal',
            maxRetries: 3,
        });
        console.log(`Found ${teamMatches.length} matches for Arsenal`);

        // Test 3: Date range filter
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        console.log('\nTesting date range filter...');
        const dateMatches = await getDataAction.execute({} as any, {
            dateFrom: today.toISOString(),
            dateTo: nextWeek.toISOString(),
            maxRetries: 3,
        });
        console.log(`Found ${dateMatches.length} matches in the next week`);

    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
