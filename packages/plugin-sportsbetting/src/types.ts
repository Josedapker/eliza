export interface PreviewMatch {
    time: string;
    match: string;
    url: string;
}

export interface PreviewSection {
    section: string;
    matches: PreviewMatch[];
}

export interface MatchPreview {
    url: string;
    homeTeam: string;
    awayTeam: string;
    matchSummary: string;
    fullArticle: string;
    prediction: string;
    statistics: string;
    probabilities: string;
    competition: string;
    venue: string;
    kickoff: string;
    referee: string;
    overview: string;
    keyAbsences: string;
    teamNews: {
        home: string[];
        away: string[];
    };
    lineups: {
        home: string[];
        away: string[];
    };
    formGuide: {
        home: string[];
        away: string[];
    };
    dataAnalysisUrl: string;
    imageUrl: string;
    tacticalInfo: string;
}
