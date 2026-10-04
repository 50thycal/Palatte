#!/usr/bin/env python3
"""
Builds data/words-en.txt: ~30k English words in frequency order, used by the
Palate Keys autocorrect and completions.

Source: hermitdave/FrequencyWords (OpenSubtitles 2018, en_50k), MIT licence.
Subtitles are conversational, which suits note-taking better than news text.

  curl -sSfLo /tmp/en50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
  python3 scripts/build-dictionary.py /tmp/en50k.txt
"""
import re
import sys

SIZE = 30000

# Misspellings and apostrophe-less contractions present in the corpus. Keeping
# them out of the dictionary is what lets autocorrect fix them.
EXCLUDE = set("""
alot thier recieve untill wich becuase definately seperate occured accomodate tommorow wierd
freind beleive goverment helo happend wat ur
im dont cant didnt doesnt isnt wasnt youre theyre thats whats ive couldnt wouldnt shouldnt
havent hasnt arent werent aint hes shes youve theyve weve youll theyll itll wouldve couldve
shouldve mustnt neednt didn doesn isn wasn couldn wouldn shouldn haven hasn aren weren don ll ve re
""".split())

# Real words that look like dropped-g forms
KEEP_IN = {'actin', 'raisin', 'rankin', 'hardin'}


def main(path):
    raw = []
    for line in open(path, encoding='utf8'):
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(r'[a-z]+', parts[0]):
            raw.append(parts[0])
    rank = {}
    for i, w in enumerate(raw):
        rank.setdefault(w, i)

    words = []
    for w in raw:
        if w in EXCLUDE or (len(w) == 1 and w not in ('a', 'i')):
            continue
        # Informal dropped-g forms ("lookin") -> let autocorrect restore the g
        if len(w) >= 5 and w.endswith('in') and w not in KEEP_IN and rank.get(w + 'g', 1e9) < rank[w]:
            continue
        if w in words[-1:]:
            continue
        words.append(w)
        if len(words) >= SIZE:
            break

    with open('data/words-en.txt', 'w', encoding='utf8') as f:
        f.write('\n'.join(words) + '\n')
    print(f'wrote {len(words)} words')


if __name__ == '__main__':
    main(sys.argv[1])
