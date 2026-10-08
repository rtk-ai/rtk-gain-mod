import { expect, mock, test } from 'claude-code/testing'

import { createState, prepareStrike, recordSummary, step } from '../hooks/lib/model.js'
import {
  ATTACKS,
  BLOCK,
  BLOCK_X,
  EFFECTS,
  ROWS,
  VIKING_FRAMES,
  keptCells,
  parseAnimation,
  pickAttack,
  pickEffect,
  runs,
  vikingCanvas,
  vikingGrid,
} from '../hooks/lib/viking.js'

const COLORS = { used: ['#3987e5', '#2f6fc0'], saved: ['#199e70', '#13845d'], idle: ['#4a4a46', '#3d3d3a'] }
const BLUE = new Set(COLORS.used)
const GREEN = new Set(COLORS.saved)
const GREY = new Set(COLORS.idle)
const STEEL = '#d6dbe0'
const SPARK = '#facc15'

const pixels = (canvas: (string | null)[][]) =>
  canvas.flatMap((row, y) => row.map((color, x) => ({ x, y, color }))).filter((p) => p.color)

// A strike with a pinned animation: the axe and the shards unless said otherwise
function struck(input: number, output: number, attack = 'axe', effect = 'shards') {
  const state = createState()
  state.fixed = { attack, effect }
  recordSummary(state, { commands: 0, input: 0, output: 0 }, null)
  recordSummary(state, { commands: 1, input, output }, 'git diff')
  return state
}

// The same numbers every run, so a test that draws lots never flakes
function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

const picture = (state: any) => JSON.stringify(vikingCanvas(state, 46, COLORS))

test('ten attacks and five effects: fifty animations', async () => {
  expect(ATTACKS.length).toBe(10)
  expect(EFFECTS.length).toBe(5)
  expect(new Set(ATTACKS).size * new Set(EFFECTS).size).toBe(50)
})

test('each of the fifty plays through, spares the kept part, and leaves nothing behind', async () => {
  for (const attack of ATTACKS) {
    for (const effect of EFFECTS) {
      const state = struck(31_800, 6_700, attack, effect)
      expect(state.viking.attack).toBe(attack)
      expect(state.viking.effect).toBe(effect)
      // Before the impact the block is whole
      let px = pixels(vikingCanvas(state, 46, COLORS))
      expect(px.filter((p) => GREEN.has(p.color)).length).toBe((BLOCK - 3) * 4)
      for (let frame = 0; frame <= VIKING_FRAMES; frame++) {
        const canvas = vikingCanvas(state, 46, COLORS)
        expect(canvas.length).toBe(ROWS * 2)
        // What is left of the saved part stays right of the cut
        expect(pixels(canvas).some((p) => GREEN.has(p.color) && p.x < BLOCK_X + 3)).toBe(false)
        step(state)
      }
      // At rest: the three kept columns are all there, nothing green is
      px = pixels(vikingCanvas(state, 46, COLORS))
      expect(px.filter((p) => BLUE.has(p.color)).length).toBe(3 * 4)
      expect(px.some((p) => GREEN.has(p.color))).toBe(false)
    }
  }
})

test('no two attacks look alike, and no two effects', async () => {
  const strikes = ATTACKS.map((attack) => {
    const state = struck(31_800, 6_700, attack, 'shards')
    while (state.viking.frame < 5) step(state)
    return picture(state)
  })
  expect(new Set(strikes).size).toBe(ATTACKS.length)

  const raised = ATTACKS.map((attack) => picture(struck(31_800, 6_700, attack, 'shards')))
  // The thrown axe starts as the axe does, and the lightning as the hammer
  expect(new Set(raised).size).toBe(ATTACKS.length - 2)

  const aftermath = EFFECTS.map((effect) => {
    const state = struck(31_800, 6_700, 'axe', effect)
    while (state.viking.frame < 12) step(state)
    return picture(state)
  })
  expect(new Set(aftermath).size).toBe(EFFECTS.length)
})

test('the draw never repeats itself and reaches all fifty', async () => {
  const random = seeded(7)
  const seen = new Set<string>()
  let attack: string | undefined
  let effect: string | undefined
  for (let i = 0; i < 2000; i++) {
    const nextAttack = pickAttack(attack, random)
    const nextEffect = pickEffect(effect, 0.5, random)
    expect(nextAttack === attack).toBe(false)
    expect(nextEffect === effect).toBe(false)
    attack = nextAttack
    effect = nextEffect
    seen.add(attack + ':' + effect)
  }
  expect(seen.size).toBe(50)
})

test('a big saving leans toward the loud effects, a small one toward the quiet', async () => {
  const count = (ratio: number) => {
    const random = seeded(11)
    let loud = 0
    for (let i = 0; i < 3000; i++) if (['shards', 'explosion', 'swept'].includes(pickEffect(undefined, ratio, random))) loud += 1
    return loud / 3000
  }
  // 3 loud effects of 5: 60 % unweighted, 9 in 11 when they weigh triple, 3 in 9 when the quiet ones do
  expect(Math.abs(count(0.5) - 0.6) < 0.04).toBe(true)
  expect(Math.abs(count(0.8) - 9 / 11) < 0.04).toBe(true)
  expect(Math.abs(count(0.1) - 3 / 9) < 0.04).toBe(true)
})

test('the weapon is chosen when the command starts, and used when it returns', async () => {
  const state = createState()
  state.random = seeded(3)
  recordSummary(state, { commands: 0, input: 0, output: 0 }, null)
  prepareStrike(state)
  const chosen = state.nextAttack
  expect(ATTACKS.includes(chosen)).toBe(true)
  state.running = 'git diff'
  const waiting = picture(state)
  state.running = null
  recordSummary(state, { commands: 1, input: 31_800, output: 6_700 }, 'git diff')
  expect(state.viking.attack).toBe(chosen)
  expect(state.nextAttack).toBe(null)
  // While the command ran he already held that weapon up: same pose, grey block
  state.running = 'again'
  state.nextAttack = chosen
  expect(picture(state)).toBe(waiting)
})

test('RTK_GAIN_ANIMATION pins an attack, an effect, or both', async () => {
  expect(parseAnimation('hammer:melt')).toEqual({ attack: 'hammer', effect: 'melt' })
  expect(parseAnimation('Raven')).toEqual({ attack: 'raven' })
  expect(parseAnimation(':dust')).toEqual({ effect: 'dust' })
  expect(parseAnimation('banana:soup')).toEqual({})
  expect(parseAnimation(undefined)).toEqual({})
})

test('the kept part of a block is in proportion, and never vanishes', async () => {
  expect(keptCells(31_800, 6_700)).toBe(3)
  expect(keptCells(100, 100)).toBe(BLOCK)
  expect(keptCells(100_000, 1)).toBe(1)
  expect(keptCells(100, 0)).toBe(0)
  expect(keptCells(0, 0)).toBe(0)
})

test('every frame is ROWS cells high and exactly as wide as asked', async () => {
  const state = struck(31_800, 6_700)
  for (let frame = 0; frame <= VIKING_FRAMES; frame++) {
    const grid = vikingGrid(state, 46, COLORS)
    expect(grid.length).toBe(ROWS)
    for (const row of grid) expect(row.length).toBe(46)
    step(state)
  }
})

test('the axe rises, lands on the cut, and the saved part bursts and falls away', async () => {
  const state = struck(31_800, 6_700)
  const cut = BLOCK_X + 3

  // Raised over the whole block: 3 blue columns and 11 green ones, 4 pixels high
  let px = pixels(vikingCanvas(state, 46, COLORS))
  expect(px.filter((p) => BLUE.has(p.color)).length).toBe(3 * 4)
  expect(px.filter((p) => GREEN.has(p.color)).length).toBe((BLOCK - 3) * 4)
  expect(px.some((p) => p.color === STEEL && p.y <= 3)).toBe(true)

  // The axe's edge lands on the cut, sparks fly
  while (state.viking.frame < 5) step(state)
  px = pixels(vikingCanvas(state, 46, COLORS))
  expect(px.some((p) => p.color === '#ffffff' && p.x === cut && p.y === 11)).toBe(true)
  expect(px.some((p) => p.color === SPARK)).toBe(true)

  // Shards: green pixels outside the block's place
  while (state.viking.frame < 10) step(state)
  px = pixels(vikingCanvas(state, 46, COLORS))
  expect(px.some((p) => GREEN.has(p.color) && (p.y < 12 || p.x >= BLOCK_X + BLOCK))).toBe(true)

  // At rest: the kept part stays, every shard is gone
  while (step(state)) {}
  px = pixels(vikingCanvas(state, 46, COLORS))
  expect(px.filter((p) => BLUE.has(p.color)).length).toBe(3 * 4)
  expect(px.some((p) => GREEN.has(p.color))).toBe(false)
})

test('while a command runs the viking waits, axe raised, over a grey block', async () => {
  const state = createState()
  state.running = 'cargo test'
  const px = pixels(vikingCanvas(state, 46, COLORS))
  expect(px.filter((p) => GREY.has(p.color)).length).toBe(BLOCK * 4)
  expect(px.some((p) => p.color === STEEL && p.y <= 3)).toBe(true)
})

test('two pixels share a cell: top as the color, bottom as the background', async () => {
  const state = createState()
  const grid = vikingGrid(state, 46, COLORS)
  // The block's two cell rows are full chunks: ▀ over a background of the same chunk
  const cell = grid[ROWS - 1][BLOCK_X]
  expect(cell[0]).toBe('▀')
  expect(GREY.has(cell[1])).toBe(true)
  expect(cell[2]).toBe(cell[1])
})

test('runs merge neighbouring cells of one look', async () => {
  const merged = runs([[['a', '#111111', null], ['b', '#111111', null], ['c', null, null], ['d', null, '#222222']]])
  expect(merged).toEqual([[
    { text: 'ab', color: '#111111', background: null },
    { text: 'c', color: null, background: null },
    { text: 'd', color: null, background: '#222222' },
  ]])
})

const gainJson = (commands: number, input: number, output: number) =>
  JSON.stringify({ summary: { total_commands: commands, total_input: input, total_output: output } })

const PANE = {
  plugin: 'rtk-gain',
  component: 'Pane',
  requestId: 'rtk-gain',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'rtk', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

function claudeCode(on: any, env: Record<string, string>) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, env)
  const readings = [gainJson(0, 0, 0), gainJson(1, 31_800, 6_700)]
  let read = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => {
    const stdout = readings[Math.min(read, readings.length - 1)]
    read += 1
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('session.usage', () => ({ value: { context: { tokens: 0, window: 200_000 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['core'] }))
  return clock
}

async function strike($: any, clock: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Bash', command: 'git diff' })
  for (let frame = 0; frame < 30; frame++) await clock.advance(33)
  await $.command.run({ command: 'rtk-gain', args: '' })
}

test('the pane shows the viking in the terminal, with the command he struck', async ($, on) => {
  const clock = claudeCode(on, { HOME: '/home/dev', RTK_GAIN_LANG: 'en' })
  await strike($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'viking' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'git diff  −79%' })).toBeDefined()
})

test('the Desktop app gets no viking: its text need not be monospaced', async ($, on) => {
  const clock = claudeCode(on, { HOME: '/home/dev', RTK_GAIN_LANG: 'en' })
  await strike($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'viking' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'rtk · session' })).toBeDefined()
})

test('RTK_GAIN_VIKING=0 keeps him out of the pane', async ($, on) => {
  const clock = claudeCode(on, { HOME: '/home/dev', RTK_GAIN_LANG: 'en', RTK_GAIN_VIKING: '0' })
  await strike($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'viking' })).toBeUndefined()
})
