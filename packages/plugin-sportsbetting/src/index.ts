import { Plugin } from '@ai16z/eliza';

import { getBetHistoryAction } from './actions/getBetHistory';
import { getDataAction } from './actions/getData';
import { getOddsAction } from './actions/getOdds';
import { placeBetAction } from './actions/placeBet';
import { trackBetAction } from './actions/trackBet';
import { betValueEvaluator } from './evaluators/betValue';
import { oddsEvaluator } from './evaluators/odds';
import { betHistoryProvider } from './providers/betHistory';
import { oddsProvider } from './providers/odds';
import { sportsDataProvider } from './providers/sportsData';

export * as actions from "./actions";
export * as evaluators from "./evaluators";
export * as providers from "./providers";

export const sportsBettingPlugin: Plugin = {
    name: "sportsbetting",
    description: "Sports betting plugin with odds tracking and bet recommendations",
    actions: [
        getDataAction,
        getOddsAction,
        placeBetAction,
        trackBetAction,
        getBetHistoryAction,
    ],
    evaluators: [
        oddsEvaluator,
        betValueEvaluator,
    ],
    providers: [
        oddsProvider,
        betHistoryProvider,
        sportsDataProvider,
    ],
};
