// The viking who breaks tokens: pixel art at the top of the pane. Pure: it
// returns rows of colored runs, and view.js turns them into Text elements.
//
// The scene is a canvas of pixels, two per terminal cell: each cell is drawn
// with '▀', its color the top pixel and its background the bottom one.
//
// When a command returns, the viking attacks the command's block of tokens at
// the cut between what was kept (blue) and what RTK saved (green), and the
// saved part is destroyed. Ten attacks and five ways to destroy make fifty
// animations; `pickAttack` and `pickEffect` choose one at random each time.

export const VIKING_FRAMES = 24
export const BLOCK = 14
export const BLOCK_X = 21
export const ROWS = 8
const HEIGHT = ROWS * 2
const BLOCK_TOP = 12
// The attack lands on frame STRIKE; the saved part holds until IMPACT
const STRIKE = 5
const IMPACT = STRIKE + 2

export const ATTACKS = ['axe', 'hammer', 'sword', 'spear', 'torch', 'twin', 'throw', 'bow', 'lightning', 'raven']
export const EFFECTS = ['shards', 'explosion', 'melt', 'dust', 'swept']

// Pixel colors, by the letter used in the sprites below
const PAL = {
  W: '#f1e9d2', // horn
  w: '#c9bc9a', // horn, shaded
  G: '#a3adb8', // helmet
  g: '#6b7480', // helmet, shaded
  s: '#e0a93b', // gold: band, buckle, beak, fletching
  K: '#f2bd8f', // skin
  k: '#d39468', // skin, shaded
  E: '#1f2937', // eyes
  R: '#e0702e', // beard
  r: '#a9471a', // beard, braided
  B: '#8c3b2b', // tunic
  b: '#6a2a1f', // tunic, shaded
  L: '#3b2a1a', // belt
  P: '#5f6670', // trousers
  O: '#3a2b20', // boots
  H: '#a0703f', // wood: handles, shafts, bow
  X: '#d6dbe0', // steel
  x: '#ffffff', // edge, string, flash
  M: '#8d99a6', // hammer stone
  m: '#c3ccd6', // hammer, lit
  V: '#8fa0b8', // raven
  v: '#5c6b82', // raven, wings
  Y: '#facc15', // spark, lightning
  o: '#f59e0b', // fire
}

// The viking, 12 pixels wide and 16 high, facing right
const BODY = [
  'W..........W',
  'Ww........wW',
  '.WwGGGGGGwW.',
  '..GGGGGGGGg.',
  '..ssssssssg.',
  '..KKKKKKKK..',
  '..KEKKKKEK..',
  '..KKKkkKKK..',
  '.RRKKKKKKRR.',
  '.RRRRRRRRRR.',
  '..RRrRRrRR..',
  '.BBBRrrRBBB.',
  'BbBBLLsLBBbB',
  '.bBBBBBBBBb.',
  '..PPP..PPP..',
  '..OOO..OOO..',
]

// --- drawing helpers: every shape is a list of [x, y, letter] pixels ---

const dots = (points, letter) => points.map(([x, y]) => [x, y, letter])

function rect(x0, y0, x1, y1, letter) {
  const out = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y, letter])
  return out
}

function line(x0, y0, x1, y1, letter) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  const out = []
  for (let i = 0; i <= steps; i++) {
    out.push([Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), letter])
  }
  return out
}

const lerp = (a, b, t) => a + (b - a) * t

// A small, fixed sequence of numbers in [0, 1): the same shards every time
function noise(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

// --- the ten attacks ---
// Each gives the hand and the weapon for four moments: `ready` (raised, also
// shown while the command runs), `swing`, `strike` (on the cut) and `rest`.
// `c` carries the cut's column, the frame, the canvas width, and `k`, the
// frames since the strike began.

const axeReady = () => [
  ...dots([[12, 10]], 'K'),
  ...dots([[13, 9], [13, 8], [14, 7], [14, 6], [15, 5], [15, 4]], 'H'),
  ...dots([[16, 0], [17, 0], [15, 1], [16, 1], [15, 2], [16, 2], [16, 3], [17, 3]], 'X'),
  ...dots([[17, 1], [17, 2]], 'x'),
]
const axeSwing = () => [
  ...dots([[12, 11]], 'K'),
  ...line(13, 11, 17, 11, 'H'),
  ...dots([[18, 9], [18, 10], [18, 11], [18, 12], [18, 13], [19, 10], [19, 11], [19, 12]], 'X'),
  ...dots([[19, 9], [19, 13]], 'x'),
]
const axeStrike = ({ cut }) => [
  ...dots([[12, 10]], 'K'),
  ...line(13, 9, cut - 2, 9, 'H'),
  ...dots([[cut - 1, 8], [cut, 8], [cut + 1, 8], [cut - 1, 9], [cut, 9], [cut + 1, 9], [cut, 10]], 'X'),
  ...dots([[cut, 11]], 'x'),
]
const axeRest = () => [
  ...dots([[12, 11]], 'K'),
  ...dots([[13, 12], [13, 13], [14, 14]], 'H'),
  ...dots([[14, 12], [15, 12], [15, 13], [16, 13], [15, 14], [16, 14]], 'X'),
  ...dots([[16, 15]], 'x'),
]

const hammerReady = () => [
  ...dots([[12, 10]], 'K'),
  ...dots([[13, 9], [13, 8], [14, 7], [14, 6], [15, 5], [15, 4]], 'H'),
  ...rect(14, 1, 18, 3, 'M'),
  ...rect(14, 0, 18, 0, 'm'),
]
const hammerRest = () => [
  ...dots([[12, 11]], 'K'),
  ...dots([[13, 12], [14, 13]], 'H'),
  ...rect(15, 14, 18, 15, 'M'),
  ...rect(15, 13, 18, 13, 'm'),
]

// An axe in the air or stuck in the ground, its head at (x, y)
const flyingAxe = (x, y, turned) => [
  ...(turned ? dots([[x - 1, y - 2], [x - 2, y - 3]], 'H') : dots([[x - 1, y + 2], [x - 2, y + 3]], 'H')),
  ...dots([[x - 1, y], [x, y], [x - 1, y + 1], [x, y + 1]], 'X'),
  ...dots([[x + 1, y], [x + 1, y + 1]], 'x'),
]
const stuckAxe = (cut) => [
  ...dots([[cut + 1, 8], [cut + 2, 7], [cut + 3, 6]], 'H'),
  ...dots([[cut - 1, 9], [cut, 9], [cut, 10]], 'X'),
  ...dots([[cut, 11]], 'x'),
]

const bow = (x, top) => [
  ...dots([[x, top], [x + 1, top + 1], [x + 1, top + 2], [x + 1, top + 3], [x + 1, top + 4], [x, top + 5]], 'H'),
  ...line(x, top + 1, x, top + 4, 'x'),
]
const stuckArrow = (cut) => [
  ...dots([[cut - 3, 8]], 's'),
  ...dots([[cut - 2, 9], [cut - 1, 10]], 'H'),
  ...dots([[cut, 11]], 'X'),
]

// A raven flying left, its beak at (x, y); the wings beat with `flap`
const raven = (x, y, flap) => [
  ...dots([[x, y]], 's'),
  ...line(x + 1, y, x + 5, y, 'V'),
  ...line(x + 2, y + 1, x + 4, y + 1, 'V'),
  ...dots([[x + 6, y]], 'v'),
  ...dots(flap ? [[x + 3, y + 2], [x + 4, y + 2]] : [[x + 3, y - 1], [x + 4, y - 1], [x + 4, y - 2]], 'v'),
]

const ATTACK = {
  // Overhead chop
  axe: { ready: axeReady, swing: axeSwing, strike: axeStrike, rest: axeRest },

  // A stone hammer comes down flat on the cut
  hammer: {
    ready: hammerReady,
    swing: () => [...dots([[12, 11]], 'K'), ...line(13, 11, 17, 11, 'H'), ...rect(18, 10, 20, 13, 'M'), ...rect(18, 9, 20, 9, 'm')],
    strike: ({ cut }) => [
      ...dots([[12, 10]], 'K'),
      ...line(13, 9, cut - 2, 9, 'H'),
      ...rect(cut - 1, 9, cut + 2, 11, 'M'),
      ...rect(cut - 1, 8, cut + 2, 8, 'm'),
    ],
    rest: hammerRest,
  },

  // A sword slices straight down through the block
  sword: {
    ready: () => [...dots([[12, 10]], 'K'), ...dots([[12, 9], [14, 9]], 's'), ...line(13, 9, 13, 1, 'X'), ...dots([[13, 0]], 'x')],
    swing: () => [...dots([[12, 10]], 'K'), ...line(13, 9, 19, 3, 'X'), ...dots([[20, 2]], 'x')],
    strike: ({ cut }) => [...dots([[12, 10]], 'K'), ...line(13, 9, cut, 11, 'X'), ...line(cut, 12, cut, 15, 'x')],
    rest: () => [...dots([[12, 11]], 'K'), ...line(13, 12, 16, 15, 'X')],
  },

  // A spear is thrust down into the cut
  spear: {
    ready: () => [...dots([[12, 10]], 'K'), ...line(13, 11, 13, 3, 'H'), ...dots([[13, 0], [13, 1], [12, 2], [13, 2], [14, 2]], 'X')],
    swing: () => [...dots([[12, 10]], 'K'), ...line(13, 10, 18, 10, 'H'), ...dots([[19, 9], [19, 10], [19, 11], [20, 10]], 'X')],
    strike: ({ cut }) => [...dots([[12, 10]], 'K'), ...line(13, 9, cut - 1, 10, 'H'), ...dots([[cut - 1, 9], [cut, 10]], 'X'), ...dots([[cut, 11]], 'x')],
    rest: () => [...dots([[12, 11]], 'K'), ...line(14, 15, 14, 5, 'H'), ...dots([[14, 2], [14, 3], [13, 4], [14, 4], [15, 4]], 'X')],
  },

  // A torch is put to the cut
  torch: {
    ready: () => [
      ...dots([[12, 10]], 'K'),
      ...dots([[13, 9], [13, 8], [14, 7], [14, 6]], 'H'),
      ...dots([[13, 5], [14, 5], [15, 5], [14, 4], [15, 4]], 'o'),
      ...dots([[14, 3], [15, 3], [14, 2]], 'Y'),
    ],
    swing: () => [
      ...dots([[12, 11]], 'K'),
      ...line(13, 11, 17, 11, 'H'),
      ...dots([[18, 10], [19, 10], [18, 11], [19, 11], [18, 12]], 'o'),
      ...dots([[20, 10], [20, 11], [19, 9]], 'Y'),
    ],
    strike: ({ cut, k }) => [
      ...dots([[12, 10]], 'K'),
      ...line(13, 9, cut - 2, 10, 'H'),
      ...dots([[cut - 1, 10], [cut, 10], [cut - 1, 11], [cut, 11], [cut + 1, 11]], 'o'),
      ...dots([[cut, 9], [cut + 1, 10], [cut, 8 - (k % 2)]], 'Y'),
    ],
    rest: () => [...dots([[12, 11]], 'K'), ...dots([[13, 12], [14, 13], [15, 14]], 'H'), ...dots([[16, 14], [16, 15]], 'o'), ...dots([[16, 13]], 'Y')],
    ownSparks: true,
  },

  // Two axes, one after the other
  twin: {
    ready: () => [...axeReady(), ...dots([[0, 9], [0, 8], [0, 7]], 'H'), ...dots([[0, 5], [1, 5], [0, 6], [1, 6]], 'X')],
    swing: () => [...axeSwing(), ...line(13, 9, 15, 9, 'H'), ...dots([[16, 8], [16, 9], [17, 8], [17, 9]], 'X')],
    strike: ({ cut }) => [
      ...axeStrike({ cut }),
      ...line(13, 10, cut + 1, 10, 'H'),
      ...dots([[cut + 2, 9], [cut + 3, 9], [cut + 2, 10], [cut + 3, 10]], 'X'),
      ...dots([[cut + 3, 11]], 'x'),
    ],
    rest: () => [...axeRest(), ...dots([[17, 13], [18, 13], [18, 14]], 'X'), ...dots([[18, 15]], 'x')],
  },

  // The axe is thrown, turns in the air, and stays planted on the cut
  throw: {
    ready: axeReady,
    swing: ({ cut, frame }) => {
      const t = frame === 3 ? 0.3 : 0.65
      return [...dots([[12, 10], [13, 9]], 'K'), ...flyingAxe(Math.round(lerp(17, cut, t)), Math.round(lerp(2, 7, t) - 3 * Math.sin(Math.PI * t)), frame === 4)]
    },
    strike: ({ cut, k }) => [...dots([[12, 10], [13, 9]], 'K'), ...(k === 0 ? flyingAxe(cut, 8, false) : stuckAxe(cut))],
    rest: ({ cut }) => [...dots([[12, 11]], 'K'), ...stuckAxe(cut)],
  },

  // An arrow is loosed in an arc and lands on the cut
  bow: {
    ready: () => [...dots([[12, 9]], 'K'), ...bow(14, 6), ...line(11, 8, 17, 8, 'H'), ...dots([[18, 8]], 'X')],
    swing: ({ cut, frame }) => {
      const t = frame === 3 ? 0.35 : 0.7
      const x = Math.round(lerp(17, cut, t))
      const y = Math.round(lerp(8, 9, t) - 6 * Math.sin(Math.PI * t))
      return [...dots([[12, 9]], 'K'), ...bow(14, 6), ...line(x - 3, y, x - 1, y, 'H'), ...dots([[x, y]], 'X')]
    },
    strike: ({ cut }) => [...dots([[12, 9]], 'K'), ...bow(14, 6), ...stuckArrow(cut)],
    rest: ({ cut }) => [...dots([[12, 11]], 'K'), ...bow(13, 9), ...stuckArrow(cut)],
  },

  // The hammer is held to the sky and lightning falls on the cut
  lightning: {
    ready: hammerReady,
    swing: () => [...hammerReady(), ...dots([[12, 1], [20, 0], [20, 3], [16, 5]], 'Y')],
    strike: ({ cut, k }) => {
      const bolt = [[2, 0], [1, 1], [1, 2], [0, 3], [1, 4], [2, 5], [1, 6], [0, 7], [-1, 8], [0, 9], [0, 10], [0, 11]]
      return [...hammerReady(), ...dots(bolt.map(([dx, y]) => [cut + dx, y]), k % 2 ? 'x' : 'Y')]
    },
    rest: hammerRest,
    ownSparks: true,
  },

  // He points, and one of Odin's ravens dives on the cut and flies off
  raven: {
    ready: ({ width }) => [...dots([[12, 10], [13, 9], [14, 8]], 'K'), ...raven(width - 8, 3, false)],
    swing: ({ cut, frame, width }) => {
      const t = frame === 3 ? 0.4 : 0.8
      return [
        ...dots([[12, 10], [13, 9], [14, 8]], 'K'),
        ...raven(Math.round(lerp(width - 8, cut, t)), Math.round(lerp(3, 9, t)), frame === 3),
      ]
    },
    strike: ({ cut, k }) => [...dots([[12, 10], [13, 9], [14, 8]], 'K'), ...raven(cut, 9 + (k % 2), k % 2 === 0)],
    rest: ({ cut, frame }) => {
      const away = frame - (STRIKE + 4)
      const flying = away < 10 ? raven(Math.round(cut + away * 2.5), Math.round(9 - away * 1.3), away % 2 === 0) : []
      return [...dots([[12, 11]], 'K'), ...flying]
    },
  },
}

// --- the five ways the saved part goes ---
// Each plots what is left of the saved pixels `t` frames after the impact.
// `e` carries the cut, the canvas width, the two saved shades and `chunk`,
// which gives a column its shade.

const EFFECT = {
  // Bursts into shards that fly up and right, and fall
  shards(plot, t, e) {
    for (let x = e.cut; x < BLOCK_X + BLOCK; x++) {
      for (let y = BLOCK_TOP; y < HEIGHT; y += 2) {
        const n = x * 7 + y
        const life = 10 + Math.floor(noise(n) * 7)
        if (t >= life) continue
        const vx = 0.5 + noise(n + 1) * 1.6
        const vy = -1.6 + noise(n + 2) * 1.1
        plot(x + vx * t, y + vy * t + 0.18 * t * t, t < life - 3 ? e.chunk(x) : e.saved[1])
      }
    }
  },

  // A flash, then everything is thrown outward from the middle
  explosion(plot, t, e) {
    const cx = (e.cut + BLOCK_X + BLOCK - 1) / 2
    const cy = BLOCK_TOP + 1.5
    if (t < 2) {
      for (let x = e.cut - 1; x <= BLOCK_X + BLOCK; x++) {
        for (let y = BLOCK_TOP - 1; y < HEIGHT; y++) plot(x, y, t === 0 ? PAL.x : PAL.Y)
      }
      return
    }
    for (let x = e.cut; x < BLOCK_X + BLOCK; x++) {
      for (let y = BLOCK_TOP; y < HEIGHT; y++) {
        const n = x * 11 + y * 3
        if (noise(n) < 0.35) continue
        const life = 8 + Math.floor(noise(n + 1) * 6)
        if (t >= life) continue
        const angle = Math.atan2(y - cy, x - cx) + (noise(n + 2) - 0.5)
        const speed = 1 + noise(n + 3) * 1.4
        const d = (t - 1) * speed
        plot(x + Math.cos(angle) * d * 1.6, y + Math.sin(angle) * d - 0.6 * d + 0.05 * t * t, t < 5 ? PAL.o : e.chunk(x))
      }
    }
  },

  // Sinks into the ground, column by column
  melt(plot, t, e) {
    for (let x = e.cut; x < BLOCK_X + BLOCK; x++) {
      const height = 4 - Math.floor(Math.max(0, t - noise(x) * 4) / 2.5)
      for (let y = HEIGHT - Math.max(0, height); y < HEIGHT; y++) plot(x, y, height < 3 ? e.saved[1] : e.chunk(x))
    }
  },

  // Crumbles to dust that drifts up
  dust(plot, t, e) {
    for (let x = e.cut; x < BLOCK_X + BLOCK; x++) {
      for (let y = BLOCK_TOP; y < HEIGHT; y++) {
        const death = noise(x * 5 + y * 13) * 12
        if (t < death) plot(x, y, e.chunk(x))
        else if (t < death + 3) plot(x + (noise(x + y) - 0.5) * 2, y - (t - death) * 1.2, e.saved[1])
      }
    }
  },

  // Swept off to the right in one piece, faster and faster
  swept(plot, t, e) {
    const dx = Math.round(0.12 * t * t + 0.5 * t)
    for (let x = e.cut; x < BLOCK_X + BLOCK; x++) {
      for (let y = BLOCK_TOP; y < HEIGHT; y++) plot(x + dx, y, e.chunk(x))
    }
    if (t > 2) {
      for (const y of [BLOCK_TOP, BLOCK_TOP + 2]) {
        for (let i = 2; i <= 6; i += 2) plot(e.cut + dx - i, y, e.saved[1])
      }
    }
  },
}

// --- choosing an animation ---

function weighted(options, weightOf, random) {
  const total = options.reduce((sum, option) => sum + weightOf(option), 0)
  let roll = random() * total
  for (const option of options) {
    roll -= weightOf(option)
    if (roll < 0) return option
  }
  return options[options.length - 1]
}

// Any attack but the one just seen
export function pickAttack(previous, random = Math.random) {
  const options = ATTACKS.filter((name) => name !== previous)
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))]
}

// Any effect but the one just seen. A big saving leans toward the loud ones,
// a small one toward the quiet ones; every effect stays possible.
export function pickEffect(previous, savedRatio, random = Math.random) {
  const loud = ['shards', 'explosion', 'swept']
  const options = EFFECTS.filter((name) => name !== previous)
  const weight = (name) => {
    if (savedRatio >= 0.7) return loud.includes(name) ? 3 : 1
    if (savedRatio < 0.3) return loud.includes(name) ? 1 : 3
    return 1
  }
  return weighted(options, weight, random)
}

// "hammer", "hammer:melt" or ":melt" -> the parts that name a known animation
export function parseAnimation(value) {
  if (typeof value !== 'string') return {}
  const [attack, effect] = value.trim().toLowerCase().split(':')
  return {
    ...(ATTACKS.includes(attack) ? { attack } : {}),
    ...(EFFECTS.includes(effect) ? { effect } : {}),
  }
}

// Cells of the command's block that stay: at least one when anything was kept
export function keptCells(input, output) {
  if (!(input > 0)) return 0
  const kept = Math.round((BLOCK * Math.max(0, output)) / input)
  return output > 0 ? Math.max(1, Math.min(BLOCK, kept)) : 0
}

// The scene as a canvas of pixel colors (null where nothing is drawn).
// `colors` gives two shades each for used, saved and idle tokens.
export function vikingCanvas(state, width, colors) {
  const canvas = Array.from({ length: HEIGHT }, () => Array.from({ length: width }, () => null))
  const plot = (x, y, color) => {
    const col = Math.round(x)
    const row = Math.round(y)
    if (row >= 0 && row < HEIGHT && col >= 0 && col < width) canvas[row][col] = color
  }
  // Tokens come in chunks of two columns, in alternating shades
  const chunk = (shades) => (x) => shades[Math.floor((x - BLOCK_X) / 2) % 2]
  const column = (x, shade) => {
    for (let y = BLOCK_TOP; y < HEIGHT; y++) plot(x, y, shade(x))
  }

  const anim = state.running ? null : state.viking
  const frame = anim?.frame ?? VIKING_FRAMES
  const kept = anim ? keptCells(anim.input, anim.output) : 0
  const cut = BLOCK_X + kept
  const attack = ATTACK[state.running ? state.nextAttack : anim?.attack] ?? ATTACK.axe
  let moment = 'rest'
  if (state.running || (anim && frame < 3)) moment = 'ready'
  else if (anim && frame < STRIKE) moment = 'swing'
  else if (anim && frame < STRIKE + 4) moment = 'strike'

  if (!anim) {
    for (let x = BLOCK_X; x < BLOCK_X + BLOCK; x++) column(x, chunk(colors.idle))
  } else {
    for (let x = BLOCK_X; x < cut; x++) column(x, chunk(colors.used))
    if (frame < IMPACT) {
      for (let x = cut; x < BLOCK_X + BLOCK; x++) column(x, chunk(colors.saved))
    } else if (frame < VIKING_FRAMES) {
      const effect = EFFECT[anim.effect] ?? EFFECT.shards
      // What is left of the saved part never covers the kept part or the viking
      const right = (x, y, color) => Math.round(x) >= cut && plot(x, y, color)
      effect(right, frame - IMPACT, { cut, width, saved: colors.saved, chunk: chunk(colors.saved) })
    }
  }

  BODY.forEach((row, y) => Array.from(row).forEach((letter, x) => letter !== '.' && plot(x + 1, y, PAL[letter])))
  for (const [x, y, letter] of attack[moment]({ cut, frame, width, k: frame - STRIKE })) plot(x, y, PAL[letter])

  if (moment === 'strike' && frame < IMPACT && !attack.ownSparks) {
    for (const [dx, y] of [[-2, 6], [2, 6], [-3, 9], [3, 9], [0, 5]]) plot(cut + dx, y, PAL.Y)
  }
  return canvas
}

// The canvas as terminal cells: [char, color, background]
export function vikingGrid(state, width, colors) {
  const canvas = vikingCanvas(state, width, colors)
  const grid = []
  for (let row = 0; row < ROWS; row++) {
    const cells = []
    for (let col = 0; col < width; col++) {
      const top = canvas[row * 2][col]
      const bottom = canvas[row * 2 + 1][col]
      if (top && bottom) cells.push(['▀', top, bottom])
      else if (top) cells.push(['▀', top, null])
      else if (bottom) cells.push(['▄', bottom, null])
      else cells.push([' ', null, null])
    }
    grid.push(cells)
  }
  return grid
}

// Rows of { text, color, background } runs: neighbouring cells of one look merged
export function runs(grid) {
  return grid.map((row) => {
    const out = []
    for (const [char, color, background] of row) {
      const last = out[out.length - 1]
      if (last && last.color === color && last.background === background) last.text += char
      else out.push({ text: char, color, background })
    }
    return out
  })
}

// One frame further. Returns true while the viking has frames left to play.
export function advanceViking(state) {
  if (!state.viking || state.viking.frame >= VIKING_FRAMES) return false
  state.viking.frame += 1
  return state.viking.frame < VIKING_FRAMES
}
