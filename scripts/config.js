export const MODULE_ID = "smart-icons-plus";

export const STATE = {
    iconKeywords: new Map(),   // path -> Set<keyword>
    compendiumKeywords: {},    // name -> { keywords, img }
    ready: false,
    indexing: null,            // Promise while an index run is in progress
    minScoreThreshold: 15,
};

// Dev Note: Feel free to add more stop words or modify the scoring values.
export const STOP_WORDS = new Set(["of", "the", "and", "a", "to", "in"]);

// Folder names that say nothing about the image (used only when "match folder names" is on).
export const GENERIC_FOLDERS = new Set([
    "modules", "systems", "worlds", "icons", "assets", "images", "image", "img", "imgs",
    "art", "artwork", "media", "uploads", "data", "files", "misc", "other", "new",
]);

// Scoring values for icon path matches (same as original Smart Icons).
export const SCORING = {
    DIRECT: 25,           // Exact word match
    PARTIAL: 15,          // Substring match
    FUZZY: 5,             // Fuzzy match via Levenshtein distance
    FUZZY_THRESHOLD: 2,   // Maximum Levenshtein distance for fuzzy matching
    FUZZY_RATIO: 0.3,     // Maximum allowed ratio (distance/word length)
    KEYWORD_LENGTH: 3     // Minimum length of keywords to consider
};

// Scoring values for compendium icon matches.
export const COMPENDIUM_SCORING = {
    BONUS: 30,
};

// How many folders are browsed in parallel while indexing.
export const BROWSE_CONCURRENCY = 8;
