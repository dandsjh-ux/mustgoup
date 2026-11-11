// Lobby settings shared by the host UI and the server.
export const DEFAULT_SETTINGS = {
  mode: 'race',            // 'race' | 'timed'
  maxPlayers: 10,          // 2-10
  finishZone: 10,          // 3, 5, 8, 10
  timer: 0,                // minutes: 0 (off), 15, 20, 30, 45
  perGate: 3,              // correct answers per gate, 1-5
  gateSpacing: 30,         // 15, 30, 60
  cooldown: 3,             // wrong-answer cooldown seconds: 0, 3, 5
  respawn: 'checkpoint',   // 'checkpoint' | 'gate'
  offensive: true,
  hazard: 'standard',      // 'gentle' | 'standard' | 'wild'
  hintLens: true,
  lateJoin: true,
  hostRole: 'spectate',    // 'play' | 'spectate'
  teamSize: 0,             // 0 = no teams, else 2-4
};

export const SETTING_FIELDS = [
  { key: 'mode', label: 'Game mode', options: [['race', 'Race to the Top'], ['timed', 'Timed Climb']] },
  { key: 'teamSize', label: 'Teams', options: [[0, 'Off (everyone for themselves)'], [2, 'Teams of 2'], [3, 'Teams of 3'], [4, 'Teams of 4']] },
  { key: 'maxPlayers', label: 'Max players', options: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, String(n)]) },
  { key: 'finishZone', label: 'Finish line', options: [[3, 'End of zone 3 (block 180)'], [5, 'End of zone 5 (block 300)'], [8, 'End of zone 8 (block 480)'], [10, 'Zone 10 summit (block 600)']] },
  { key: 'timer', label: 'Timer', options: [[0, 'Off'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min']] },
  { key: 'perGate', label: 'Correct answers per gate', options: [1, 2, 3, 4, 5].map((n) => [n, String(n)]) },
  { key: 'gateSpacing', label: 'Gate spacing', options: [[15, 'Every 15 blocks'], [30, 'Every 30 blocks'], [60, 'Every 60 blocks']] },
  { key: 'cooldown', label: 'Wrong-answer cooldown', options: [[0, 'Off'], [3, '3 s'], [5, '5 s']] },
  { key: 'respawn', label: 'Respawn point', options: [['checkpoint', 'Zone checkpoints only'], ['gate', 'Every cleared gate']] },
  { key: 'offensive', label: 'Offensive items', options: [[true, 'On'], [false, 'Off']] },
  { key: 'hazard', label: 'Hazard level', options: [['gentle', 'Gentle'], ['standard', 'Standard'], ['wild', 'Wild']] },
  { key: 'hintLens', label: 'Hint Lens (question helper)', options: [[true, 'On'], [false, 'Off']] },
  { key: 'lateJoin', label: 'Late joining', options: [[true, 'On'], [false, 'Off']] },
  { key: 'hostRole', label: 'Host role', options: [['spectate', 'Spectate (projector view)'], ['play', 'Play']] },
];

export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const f of SETTING_FIELDS) {
    if (!(f.key in input)) continue;
    let v = input[f.key];
    const sample = f.options[0][0];
    if (typeof sample === 'number') v = Number(v);
    if (typeof sample === 'boolean') v = v === true || v === 'true';
    if (f.options.some((o) => o[0] === v)) out[f.key] = v;
  }
  return out;
}

export const HAZARD_LEVELS = {
  gentle: { freq: 0.5, push: 0.6 },
  standard: { freq: 1, push: 1 },
  wild: { freq: 1.5, push: 1 },
};
