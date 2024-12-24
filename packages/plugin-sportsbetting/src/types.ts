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
    keyAbsences?: string;
    teamNews?: {
        home: string[];
        away: string[];
    };
    prediction: string;
    statistics: string;
    probabilities: string;
    formGuide?: {
        home: string[];
        away: string[];
    };
    fullArticle: string;
    lineups?: {
        home: string[];
        away: string[];
    };
    overview?: string;
    homeDetails?: string;
    awayDetails?: string;
    scoreAnalysis?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    analysis?: string;
    homeScore?: string;
    awayScore?: string;
    date?: string;
    kickoff?: string;
    dataAnalysisUrl?: string;
    previewImage?: string;
    competition?: string;
    venue?: string;
    referee?: string;
    homeForm?: string[];
    awayForm?: string[];
    headToHead?: string[];
}
