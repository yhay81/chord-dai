const pitchNamesSharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchNamesFlat = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const pitchIndex = new Map([
  ["C", 0],
  ["B#", 0],
  ["C#", 1],
  ["Db", 1],
  ["D", 2],
  ["D#", 3],
  ["Eb", 3],
  ["E", 4],
  ["Fb", 4],
  ["E#", 5],
  ["F", 5],
  ["F#", 6],
  ["Gb", 6],
  ["G", 7],
  ["G#", 8],
  ["Ab", 8],
  ["A", 9],
  ["A#", 10],
  ["Bb", 10],
  ["B", 11],
  ["Cb", 11],
]);

/** @param {string} token */
export const normalizeChord = (token) => token.replaceAll("♯", "#").replaceAll("♭", "b").trim();

/** @param {string} token */
export const parseChord = (token) => {
  const value = normalizeChord(token);
  if (value === "N.C." || value === "N.C" || value === "%") return { literal: value };
  const match = /^([A-G])([#b]?)([^/\s]*?)(?:\/([A-G])([#b]?))?$/.exec(value);
  if (!match) return null;
  const root = `${match[1]}${match[2]}`;
  const bass = match[4] ? `${match[4]}${match[5]}` : "";
  const suffix = match[3];
  if (
    !pitchIndex.has(root) ||
    (bass && !pitchIndex.has(bass)) ||
    !/^(?:(?:maj|min|dim|aug|sus|add|no)|[mM]|[0-9]|[-#b()+,])*$/.test(suffix)
  ) {
    return null;
  }
  return { root, suffix, bass, preferFlat: match[2] === "b" || match[5] === "b" };
};

/**
 * @param {string} name
 * @param {number} semitones
 * @param {boolean} preferFlat
 */
const shiftName = (name, semitones, preferFlat) => {
  const next = ((pitchIndex.get(name) ?? 0) + semitones + 120) % 12;
  return (preferFlat ? pitchNamesFlat : pitchNamesSharp)[next];
};

/**
 * @param {string} token
 * @param {number} semitones
 */
export const transposeChord = (token, semitones) => {
  const chord = parseChord(token);
  if (!chord || chord.literal) return chord?.literal ?? token;
  const root = shiftName(chord.root, semitones, chord.preferFlat);
  const bass = chord.bass ? `/${shiftName(chord.bass, semitones, chord.preferFlat)}` : "";
  return `${root}${chord.suffix}${bass}`;
};

/** @param {string} line */
export const isChordOnlyLine = (line) => {
  const compact = line.replaceAll("|", " ").trim();
  if (!compact) return false;
  const tokens = compact.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => parseChord(token) || /^[-:%]+$/.test(token));
};
