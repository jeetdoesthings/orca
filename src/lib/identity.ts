/**
 * Canonical Identity & Deduplication Layer for ORCA.
 * Resolves artist names to their canonical form, maps aliases,
 * and maintains consistent IDs.
 */

// Normalized alias-resolution map for famous artists
const ALIAS_MAP: Record<string, string> = {
  // Hip-Hop / Rap
  'kendrick lamar': 'Kendrick Lamar',
  'travis scott': 'Travis Scott',
  'drake': 'Drake',
  'future': 'Future',
  'tyler, the creator': 'Tyler, The Creator',
  'tyler the creator': 'Tyler, The Creator',
  'j. cole': 'J. Cole',
  'j cole': 'J. Cole',
  'kanye west': 'Kanye West',
  'ye': 'Kanye West',
  'playboi carti': 'Playboi Carti',
  'lil uzi vert': 'Lil Uzi Vert',
  'metro boomin': 'Metro Boomin',
  'central cee': 'Central Cee',
  'pop smoke': 'Pop Smoke',
  'chief keef': 'Chief Keef',
  'fivio foreign': 'Fivio Foreign',
  'jay-z': 'Jay-Z',
  'jay z': 'Jay-Z',

  // Electronic / House / EDM
  'skrillex': 'Skrillex',
  'fred again..': 'Fred again..',
  'fred again': 'Fred again..',
  'fred again.': 'Fred again..',
  'four tet': 'Four Tet',
  'porter robinson': 'Porter Robinson',
  'flume': 'Flume',
  'disclosure': 'Disclosure',
  'odesza': 'ODESZA',
  'bicep': 'Bicep',
  'jamie xx': 'Jamie xx',
  'deadmau5': 'Deadmau5',
  'swedish house mafia': 'Swedish House Mafia',
  'martin garrix': 'Martin Garrix',
  'daft punk': 'Daft Punk',
  'peggy gou': 'Peggy Gou',
  'charlotte de witte': 'Charlotte de Witte',
  'carl cox': 'Carl Cox',
  'richie hawtin': 'Richie Hawtin',
  'amelie lens': 'Amelie Lens',
  'armin van buuren': 'Armin van Buuren',
  'tiesto': 'Tiësto',
  'above & beyond': 'Above & Beyond',
  'paul van dyk': 'Paul van Dyk',
  'chase & status': 'Chase & Status',
  'sub focus': 'Sub Focus',
  'pendulum': 'Pendulum',
  'andy c': 'Andy C',
  'wilkinson': 'Wilkinson',
  'aphex twin': 'Aphex Twin',
  'brian eno': 'Brian Eno',
  'boards of canada': 'Boards of Canada',

  // Pop / Rock
  'taylor swift': 'Taylor Swift',
  'billie eilish': 'Billie Eilish',
  'the weeknd': 'The Weeknd',
  'dua lipa': 'Dua Lipa',
  'harry styles': 'Harry Styles',
  'lady gaga': 'Lady Gaga',
  'katy perry': 'Katy Perry',
  'britney spears': 'Britney Spears',
  'kylie minogue': 'Kylie Minogue',
  'charli xcx': 'Charli XCX',
  'coldplay': 'Coldplay',
  'queen': 'Queen',
  'radiohead': 'Radiohead',
  'foo fighters': 'Foo Fighters',
  'arctic monkeys': 'Arctic Monkeys',
  'nirvana': 'Nirvana',
  'muse': 'Muse',
  'the white stripes': 'The White Stripes',
  'linkin park': 'Linkin Park',
  'pixies': 'Pixies',
  'the strokes': 'The Strokes',
  'tame impala': 'Tame Impala',
  'mac demarco': 'Mac DeMarco',
  'phoebe bridgers': 'Phoebe Bridgers',
  'vampire weekend': 'Vampire Weekend',
  'green day': 'Green Day',
  'blink-182': 'blink-182',
  'ramones': 'Ramones',
  'the clash': 'The Clash',
  'sex pistols': 'Sex Pistols',
  'metallica': 'Metallica',
  'iron maiden': 'Iron Maiden',
  'black sabbath': 'Black Sabbath',
  'slipknot': 'Slipknot',
  'system of a down': 'System of a Down',

  // R&B / Soul / Funk
  'sza': 'SZA',
  'frank ocean': 'Frank Ocean',
  'alicia keys': 'Alicia Keys',
  'usher': 'Usher',
  'khalid': 'Khalid',
  'aretha franklin': 'Aretha Franklin',
  'marvin gaye': 'Marvin Gaye',
  'leon bridges': 'Leon Bridges',
  'erykah badu': 'Erykah Badu',
  'stevie wonder': 'Stevie Wonder',
  'bruno mars': 'Bruno Mars',
  'parliament': 'Parliament',
  'jamiroquai': 'Jamiroquai',
  'earth, wind & fire': 'Earth, Wind & Fire',
  'funkadelic': 'Funkadelic',

  // Folk / Country / Jazz / Classical
  'bob dylan': 'Bob Dylan',
  'bon iver': 'Bon Iver',
  'fleet foxes': 'Fleet Foxes',
  'mumford & sons': 'Mumford & Sons',
  'iron & wine': 'Iron & Wine',
  'johnny cash': 'Johnny Cash',
  'dolly parton': 'Dolly Parton',
  'luke combs': 'Luke Combs',
  'kacey musgraves': 'Kacey Musgraves',
  'chris stapleton': 'Chris Stapleton',
  'ludovico einaudi': 'Ludovico Einaudi',
  'max joker': 'Max Richter',
  'max richter': 'Max Richter',
  'hans zimmer': 'Hans Zimmer',
  'yann tiersen': 'Yann Tiersen',
  'yiruma': 'Yiruma',
  'miles davis': 'Miles Davis',
  'john coltrane': 'John Coltrane',
  'ella fitzgerald': 'Ella Fitzgerald',
  'norah jones': 'Norah Jones',
  'kamasi washington': 'Kamasi Washington',

  // Global / Latin / World
  'bad bunny': 'Bad Bunny',
  'rosalia': 'Rosalía',
  'rosalía': 'Rosalía',
  'shakira': 'Shakira',
  'j balvin': 'J Balvin',
  'daddy yankee': 'Daddy Yankee',
  'fela kuti': 'Fela Kuti',
  'burna boy': 'Burna Boy',
  'bob marley': 'Bob Marley',
  'ravi shankar': 'Ravi Shankar',
  'tinariwen': 'Tinariwen',
};

/**
 * Normalises an artist name for lookup/comparison.
 * Lowercases, strips trailing/leading spaces, and collapses extra whitespace.
 */
export function normaliseArtistName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Resolves an artist name to its canonical display form.
 * Tries the alias map first, then checks if it's a collaborative name and resolves
 * it to the most popular primary artist.
 */
export function getCanonicalArtistName(name: string): string {
  const cleanName = name.trim();
  const norm = normaliseArtistName(cleanName);

  // 1. Direct exact alias match
  if (ALIAS_MAP[norm]) {
    return ALIAS_MAP[norm];
  }

  // 2. Intelligent collaboration splitting
  // Detects: " & ", " and ", " feat ", " feat. ", " featuring ", " with ", " vs ", " vs. ", ","
  const splitPattern = /\s+(?:&|and|feat\.?|featuring|with|vs\.?)\s+|,\s+/i;
  if (splitPattern.test(cleanName)) {
    const parts = cleanName.split(splitPattern);
    
    // Check if any part in the collaboration is a canonical artist in our ALIAS_MAP
    for (const part of parts) {
      const partNorm = normaliseArtistName(part);
      if (ALIAS_MAP[partNorm]) {
        console.log(`[IDENTITY] Resolved collaboration "${cleanName}" -> Canonical Artist "${ALIAS_MAP[partNorm]}"`);
        return ALIAS_MAP[partNorm];
      }
    }
    
    // Default fallback to first artist of the collaboration if none is in our list
    if (parts[0]) {
      return parts[0].trim();
    }
  }

  return cleanName;
}

/**
 * Returns a stable canonical ID derived purely from the normalised canonical name.
 * Discards MusicBrainz ID for ID creation to completely prevent duplicate profiles
 * where one has MBID and another does not.
 */
export function getCanonicalArtistId(name: string, _mbid?: string): string {
  const canonical = getCanonicalArtistName(name);
  return 'lastfm-' + normaliseArtistName(canonical).replace(/[^a-z0-9]/g, '-');
}
