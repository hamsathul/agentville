// Text a world controls, made plain before it is printed to your terminal. A world's code is untrusted while
// check-world runs it or world-shots takes its pictures, and a terminal acts on the control sequences in what
// it prints: they could forge a report, retitle or clear the window, and in some terminals set the clipboard.
// So whatever a world can put in its words (an exception's message, a creature's name or line, an outfit
// part, its panel and error text, and everything a contained check prints) goes through plain() on its way
// to the terminal. No dependencies.

// Control strings (OSC, ended by BEL or ST; DCS, SOS, PM and APC, ended by ST), then CSI, then the other
// escape sequences (ESC, any intermediates, a final). One that is never finished loses its ESC below.
const STRINGS = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\/g;
const CSI = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
const ESCAPES = /\x1b[\x20-\x2f]*[\x30-\x7e]/g;
// Every C0 control but tab and newline, DEL, the C1 controls, and the bidi controls (Unicode's Bidi_Control:
// the embeddings, overrides and isolates, which can make text read in another order than it is, and the marks).
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\p{Bidi_Control}]/gu;

/** `text` (made a string) without escape sequences or control characters but newline and tab, cut to `max` characters with an ellipsis. */
export function plain(text, max = 300) {
  const s = String(text).replace(STRINGS, '').replace(CSI, '').replace(ESCAPES, '').replace(CONTROLS, '');
  const chars = [...s]; // by character, so a cut never splits one
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…` : s;
}

/** plain(), on one line: each line break becomes a space, so a world's words can't start a line of a report of their own. */
export const oneLine = (text, max = 300) => plain(String(text).replace(/\s*[\n\r]\s*/g, ' '), max);
