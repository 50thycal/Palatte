import Foundation

/// Apostrophe-free spellings and what they mean.
enum Contractions {
    /// Spellings that are right as typed ("id", "ill", "lets" are real words).
    static let leaveAlone: Set<String> = ["id", "ill", "lets"]

    static let fixes: [String: String] = [
        "im": "I'm", "ive": "I've", "i": "I",
        "i'm": "I'm", "i've": "I've", "i'd": "I'd", "i'll": "I'll",
        "dont": "don't", "cant": "can't", "wont": "won't", "didnt": "didn't", "doesnt": "doesn't",
        "isnt": "isn't", "wasnt": "wasn't", "werent": "weren't", "arent": "aren't",
        "couldnt": "couldn't", "wouldnt": "wouldn't", "shouldnt": "shouldn't",
        "havent": "haven't", "hasnt": "hasn't", "hadnt": "hadn't", "mustnt": "mustn't",
        "youre": "you're", "theyre": "they're", "youve": "you've", "theyve": "they've",
        "weve": "we've", "youll": "you'll", "theyll": "they'll", "itll": "it'll",
        "thats": "that's", "whats": "what's", "wheres": "where's", "whos": "who's",
        "hows": "how's", "theres": "there's", "heres": "here's",
        "hes": "he's", "shes": "she's", "aint": "ain't", "yall": "y'all",
        "wouldve": "would've", "couldve": "could've", "shouldve": "should've",
    ]
}
