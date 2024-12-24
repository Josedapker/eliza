import { Provider } from '@ai16z/eliza';

export const oddsProvider: Provider = {
    name: "ODDS_PROVIDER",
    description: "Provides real-time betting odds",
    handler: async (runtime, memory, state) => {
        // Implementation coming soon
        return {
            odds: []
        };
    }
};
