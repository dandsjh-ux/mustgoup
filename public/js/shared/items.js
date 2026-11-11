// Shop catalogue shared by server (prices, rules) and client (pictures, descriptions).
// zone = first checkpoint zone that sells it (1 = start).
export const ITEMS = {
  rewind: { name: 'Rewind Module', kind: 'Safety', price: 5, zone: 1, uses: 3, icon: '⏪', desc: 'Falling? Press Rewind to go back to the last platform you stood on. 3 uses.' },
  spring: { name: 'Spring Shoes', kind: 'Mobility', price: 3, zone: 1, uses: 1, icon: '👟', desc: 'Use them to jump 30% higher until the next checkpoint.' },
  snack: { name: 'Speed Snack', kind: 'Mobility', price: 2, zone: 1, uses: 2, icon: '🍪', desc: 'Eat a snack to run 40% faster for 15 seconds. You get 2 snacks.' },
  hint: { name: 'Hint Lens', kind: 'Learning', price: 3, zone: 1, uses: 2, icon: '🔍', desc: 'At a gate, it takes away one wrong answer. 2 uses.', needs: 'hintLens' },
  jetpack: { name: 'Jetpack', kind: 'Mobility', price: 8, zone: 2, kept: true, icon: '🚀', desc: 'Press jump three times to fly up. It comes with a full tank and you keep it all game.' },
  fuel: { name: 'Fuel Cell', kind: 'Mobility', price: 3, zone: 2, uses: 1, icon: '🔋', desc: 'Fills your jetpack tank again.', requires: 'jetpack' },
  glider: { name: 'Glider Cape', kind: 'Safety', price: 4, zone: 2, uses: 1, icon: '🪂', desc: 'Hold jump while you fall to glide slowly. It lasts until the next checkpoint.' },
  cloud: { name: 'Cloud Step', kind: 'Safety', price: 4, zone: 3, uses: 2, icon: '☁️', desc: 'Makes a cloud under your feet for 5 seconds. 2 uses.' },
  shield: { name: 'Bubble Shield', kind: 'Defence', price: 4, zone: 3, uses: 1, icon: '🛡️', desc: 'Blocks the next push from an item, an enemy or the weather. While it is on, wind and waterfall currents cannot move you at all.' },
  glove: { name: 'Boing Glove', kind: 'Offensive', price: 5, zone: 3, uses: 2, offensive: true, icon: '🥊', desc: 'Punch a player near you to push them back. 2 uses.' },
  cleats: { name: 'Ice Cleats', kind: 'Mobility', price: 3, zone: 4, kept: true, icon: '⛸️', desc: 'Your feet will not slip on ice any more. You keep them all game.' },
  gust: { name: 'Gust Bomb', kind: 'Offensive', price: 7, zone: 5, uses: 1, offensive: true, icon: '💨', desc: 'Throw a cloud bomb. It pushes away everyone near the place it lands.' },
  oxygen: { name: 'Oxygen Tank', kind: 'Space', price: 3, zone: 10, instant: true, icon: '🤿', desc: 'Gives you 60 more seconds of air in space.' },
};

export const ITEM_ORDER = ['rewind', 'spring', 'snack', 'hint', 'jetpack', 'fuel', 'glider', 'cloud', 'shield', 'glove', 'cleats', 'gust', 'oxygen'];
export const MAX_SLOTS = 4;
export const maxUses = (id) => (ITEMS[id].uses || 1) * 2;

export const TOKENS = { start: 3, checkpoint: 6, perfect: 1, catchUp: 2 };

export const ITEM_RULES = {
  gloveRange: 3,
  gustRadius: 3,
  gustThrow: 7,
  offenseVertical: 6,
  immunityMs: 8000,
  undoMs: 10000,
};

// Cosmetics: free choice at the start (no tokens).
export const HATS = [
  { id: 'none', name: 'No hat', icon: '🚫' },
  { id: 'party', name: 'Party hat', icon: '🥳' },
  { id: 'crown', name: 'Crown', icon: '👑' },
  { id: 'flower', name: 'Flower', icon: '🌸' },
  { id: 'beanie', name: 'Beanie', icon: '🧢' },
  { id: 'tophat', name: 'Top hat', icon: '🎩' },
];
export const TRAILS = [
  { id: 'none', name: 'No trail', icon: '🚫' },
  { id: 'sparkles', name: 'Sparkles', icon: '✨' },
  { id: 'hearts', name: 'Hearts', icon: '💖' },
  { id: 'stars', name: 'Stars', icon: '⭐' },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈' },
];

export const ANIMALS = [
  { id: 'bunny', name: 'Bunny', emoji: '🐰' },
  { id: 'fox', name: 'Fox', emoji: '🦊' },
  { id: 'panda', name: 'Panda', emoji: '🐼' },
  { id: 'penguin', name: 'Penguin', emoji: '🐧' },
  { id: 'kitten', name: 'Kitten', emoji: '🐱' },
  { id: 'frog', name: 'Frog', emoji: '🐸' },
  { id: 'duckling', name: 'Duckling', emoji: '🐥' },
  { id: 'redpanda', name: 'Red Panda', emoji: '🦝' },
  { id: 'hedgehog', name: 'Hedgehog', emoji: '🦔' },
  { id: 'koala', name: 'Koala', emoji: '🐨' },
  { id: 'puppy', name: 'Puppy', emoji: '🐶' },
  { id: 'tiger', name: 'Tiger Cub', emoji: '🐯' },
];
export const TINT_COLORS = ['#ff5a5f', '#3a86ff', '#2ec27e', '#9b5de5', '#ff9f1c', '#ff70a6'];
export const TINT_NAMES = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Pink'];
export const EMOTES = [
  { id: 1, name: 'Wave', icon: '👋' },
  { id: 2, name: 'Cheer', icon: '🎉' },
  { id: 3, name: 'Dance', icon: '💃' },
  { id: 4, name: 'Thumbs up', icon: '👍' },
];

export function cleanProfile(p = {}) {
  const animal = ANIMALS.some((a) => a.id === p.animal) ? p.animal : 'bunny';
  const tint = Math.max(0, Math.min(5, p.tint | 0));
  const hat = HATS.some((h) => h.id === p.hat) ? p.hat : 'none';
  const trail = TRAILS.some((t) => t.id === p.trail) ? p.trail : 'none';
  return { animal, tint, hat, trail };
}
