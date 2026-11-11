// Simple name filter for a classroom game. Not exhaustive: it catches the obvious cases.
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'piss', 'bastard', 'slut', 'whore', 'fag', 'nigg', 'nazi',
  'hitler', 'rape', 'porn', 'penis', 'vagina', 'boob', 'tits', 'asshole', 'wank', 'twat', 'poop', 'butthole',
  'stupid', 'idiot', 'loser', 'fatty', 'retard', 'crap', 'bollock', 'prick',
];
// Short words like "die" or "kill" are left out on purpose: they appear inside real names (Diego, Killian).
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

function squash(s) {
  return s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

export function isBlocked(text) {
  const s = squash(String(text || ''));
  return BLOCKED.some((w) => s.includes(w.replace(/(.)\1+/g, '$1')));
}

/** Returns a tidy first name or null if it is not allowed. */
export function cleanName(raw) {
  let name = String(raw || '')
    .replace(/[^\p{L}\p{N} '\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (!name) return null;
  if (isBlocked(name)) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
