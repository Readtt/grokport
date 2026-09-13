// Terminal escape sequences: CSI (colors, cursor moves), OSC (window titles, links) and short ESC codes.
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;
// Control characters except tab and newline, including DEL and the 8-bit C1 range.
const CONTROL_CHARACTER = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/**
 * Makes text written by someone else safe to print and to save: strips terminal control codes,
 * keeps tabs and newlines, and normalizes line endings.
 */
export function cleanText(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(ESCAPE_SEQUENCE, '').replace(CONTROL_CHARACTER, '');
}
