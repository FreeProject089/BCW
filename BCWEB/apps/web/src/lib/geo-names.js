// ISO alpha-2 → the country name used in `public/world.json`, for the analytics choropleth.
//
// WHY A MAP AT ALL
//
// world.json is a simplified Natural Earth extract and its features carry only a `name` —
// no ISO code (checked: the only properties present are name, childNum, cp). So a visitor's
// country code has to be turned into a NAME before the map can shade anything, and the two
// vocabularies disagree: CLDR (what Intl.DisplayNames speaks) says "Czechia", Natural Earth
// says "Czech Rep."; CLDR says "Eswatini", the file says "Swaziland".
//
// WHY IT IS WRITTEN OUT RATHER THAN COMPUTED
//
// A normaliser was tried first — expand "Rep."/"Is."/"St.", drop accents and punctuation,
// then compare. It scored WORSE than a hand table (195 codes placed against 203), because
// the differences that matter are not spelling: Czechia/Czech Rep., Eswatini/Swaziland,
// Congo - Kinshasa/Dem. Rep. Congo, North Korea/Dem. Rep. Korea are different NAMES for the
// same place. No amount of string surgery bridges those, and the surgery breaks pairs that
// already matched. So the differences are listed, and the list is CHECKED instead of
// trusted — see scripts/check-geo-names.mjs.
//
// The table this replaces was hand-maintained and never validated against world.json. It
// held 29 entries: 13 were redundant (Intl already returned the file's exact name), and
// 2 were WRONG in a way nothing could notice — `LA: 'Laos'` and `TW: 'Taiwan'` name no
// feature in this file, so Laos and Taiwan silently never shaded. 17 real differences were
// missing entirely.

/** Codes whose CLDR name differs from the name in world.json. Every value is asserted to
 *  exist in world.json by scripts/check-geo-names.mjs, so a typo cannot survive a build. */
export const FEATURE_NAME = {
    AG: 'Antigua and Barb.',
    AX: 'Aland',
    BA: 'Bosnia and Herz.',
    CD: 'Dem. Rep. Congo',
    CF: 'Central African Rep.',
    CG: 'Congo',
    CI: "Côte d'Ivoire",
    CZ: 'Czech Rep.',
    DO: 'Dominican Rep.',
    EH: 'W. Sahara',
    FK: 'Falkland Is.',
    FO: 'Faeroe Is.',
    GQ: 'Eq. Guinea',
    GS: 'S. Geo. and S. Sandw. Is.',
    HM: 'Heard I. and McDonald Is.',
    IO: 'Br. Indian Ocean Ter.',
    KP: 'Dem. Rep. Korea',
    KR: 'Korea',
    KY: 'Cayman Is.',
    LA: 'Lao PDR',
    LC: 'Saint Lucia',
    MK: 'Macedonia',
    MM: 'Myanmar',
    MP: 'N. Mariana Is.',
    PF: 'Fr. Polynesia',
    PM: 'St. Pierre and Miquelon',
    PS: 'Palestine',
    SB: 'Solomon Is.',
    SH: 'Saint Helena',
    SS: 'S. Sudan',
    ST: 'São Tomé and Principe',
    SZ: 'Swaziland',
    TC: 'Turks and Caicos Is.',
    TF: 'Fr. S. Antarctic Lands',
    TR: 'Turkey',
    TT: 'Trinidad and Tobago',
    VC: 'St. Vin. and Gren.',
    VI: 'U.S. Virgin Is.',
    // Withdrawn ISO codes. Current geoip data does not emit them, but events stored years
    // ago might, and they name real countries — so they resolve rather than sit in the
    // "absent from this map" list, which would be untrue of them.
    BU: 'Myanmar',            // Burma
    ZR: 'Dem. Rep. Congo',    // Zaire
};

/** Codes with NO feature in this map file.
 *
 *  Not a bug and not fixable by a better name: world.json is a simplified world at 217
 *  features, and micro-states, most overseas territories and a few disputed areas are not
 *  in it. A visitor from one of these still appears in the Countries LIST with a real
 *  count — only the shaded map cannot show them.
 *
 *  Listing them explicitly is what turns "the mapping is incomplete somewhere" into "the
 *  mapping is complete, and these are the known absences": the check script requires every
 *  ISO code to be in exactly one of the two sets.
 */
export const ABSENT_FROM_MAP = new Set([
    // Territories, micro-states and disputed areas with no feature in this file.
    'AC', 'AI', 'AQ', 'AW', 'BL', 'BQ', 'BV', 'CC', 'CK', 'CP', 'CQ', 'CX', 'DG', 'EA', 'GF',
    'GG', 'GI', 'GP', 'HK', 'IC', 'KN', 'MC', 'MF', 'MH', 'MO', 'MQ', 'MV', 'NF', 'NR', 'PN',
    'RE', 'SJ', 'SM', 'SX', 'TA', 'TK', 'TV', 'TW', 'UM', 'VA', 'VG', 'WF', 'XK', 'YT',
    // Not countries at all: CLDR also hands out codes for groupings and for its own test
    // locales. They can never appear in geoip data; they are listed so the check below can
    // demand that EVERY code Intl knows is accounted for, with no "except the odd ones".
    'EU', 'EZ', 'QO', 'UN', 'XA', 'XB', 'ZZ',
]);

const DISPLAY = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

/**
 * The world.json feature name for a country code, or null when this map has no such
 * country.
 *
 * Returning null rather than a guess is deliberate: a wrong name shades the WRONG country,
 * which is worse than shading none — and worse still because it looks like data.
 */
export function featureNameFor(cc) {
    const code = String(cc || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    if (FEATURE_NAME[code]) return FEATURE_NAME[code];
    if (ABSENT_FROM_MAP.has(code)) return null;
    if (!DISPLAY) return null;
    let name;
    try { name = DISPLAY.of(code); } catch { return null; }
    return name && name !== code ? name : null;
}
