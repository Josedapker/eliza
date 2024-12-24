import { Provider } from '@ai16z/eliza';

export const betHistoryProvider: Provider = {
    name: "BET_HISTORY_PROVIDER",
    description: "Provides betting history data",
    handler: async (runtime, memory, state) => {
        // Implementation coming soon
        return {
            history: []
        };
    }
};
