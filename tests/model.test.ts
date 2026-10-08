import { expect, test } from 'claude-code/testing'

import { percent, shortCommand, tokens } from '../hooks/lib/format.js'
import { VIKING_FRAMES } from '../hooks/lib/viking.js'
import {
  FRAMES,
  allocate,
  contextView,
  createState,
  mode,
  parseProxy,
  parseSummary,
  proxyQuery,
  readUsage,
  recordSummary,
  sessionTotals,
  setContext,
  startTurn,
  step,
  turnTotals,
} from '../hooks/lib/model.js'

const gain = (commands: number, input: number, output: number) => ({ commands, input, output })

test('tokens and percent read the way the pane prints them', async () => {
  expect(tokens(310)).toBe('310')
  expect(tokens(48_200)).toBe('48.2k')
  expect(tokens(48_200, 'fr')).toBe('48,2 k')
  expect(tokens(200_000, 'fr')).toBe('200 k')
  expect(tokens(1_240_000, 'fr')).toBe('1,24 M')
  expect(percent(48_200, 9_100)).toBe('−81%')
  expect(percent(48_200, 9_100, 'fr')).toBe('−81 %')
  expect(percent(0, 0, 'fr')).toBe('0 %')
  // A passthrough command saves nothing and must not read as a gain
  expect(percent(500, 500)).toBe('0%')
})

test('a command is named by its program and subcommand', async () => {
  expect(shortCommand('cargo test --all')).toBe('cargo test')
  expect(shortCommand('RUSTFLAGS=-D cargo clippy 2>&1 | tail -5')).toBe('cargo clippy')
  expect(shortCommand('rtk git status')).toBe('git status')
  expect(shortCommand('/usr/bin/ls -la')).toBe('ls')
  expect(shortCommand('cd /tmp && make')).toBe('cd')
  expect(shortCommand(undefined)).toBe('')
})

test('rtk gain JSON is read, and anything else is refused', async () => {
  const stdout = JSON.stringify({ summary: { total_commands: 8, total_input: 996, total_output: 740 } })
  expect(parseSummary(stdout)).toEqual({ commands: 8, input: 996, output: 740 })
  expect(parseSummary('rtk: no data')).toBe(null)
  expect(parseSummary('{"summary":{}}')).toBe(null)
})

test('the first reading is the baseline, later ones are the session', async () => {
  const state = createState()
  expect(recordSummary(state, gain(100, 50_000, 20_000), null)).toBe(null)
  expect(sessionTotals(state)).toEqual({ commands: 0, input: 0, output: 0, saved: 0 })

  const delta = recordSummary(state, gain(101, 88_400, 25_900), 'cargo test')
  expect(delta).toEqual({ commands: 1, input: 38_400, output: 5_900 })
  expect(sessionTotals(state)).toEqual({ commands: 1, input: 38_400, output: 5_900, saved: 32_500 })
  expect(state.commands[0]).toEqual({ name: 'cargo test', input: 38_400, output: 5_900, count: 1 })

  // A command rtk did not handle leaves the totals where they were
  expect(recordSummary(state, gain(101, 88_400, 25_900), 'echo hi')).toBe(null)
  expect(state.commands.length).toBe(1)

  // A command rtk counted but that carried no tokens adds no "0 → 0" row
  expect(recordSummary(state, gain(102, 88_400, 25_900), 'git log')).toBe(null)
  expect(state.commands.length).toBe(1)
  expect(sessionTotals(state).commands).toBe(2)
})

test('cleared history restarts the session from zero', async () => {
  const state = createState()
  recordSummary(state, gain(100, 50_000, 20_000), null)
  recordSummary(state, gain(101, 60_000, 22_000), 'git diff')
  expect(recordSummary(state, gain(0, 0, 0), null)).toBe(null)
  expect(sessionTotals(state).input).toBe(0)
  expect(state.commands).toEqual([])
})

test('a turn counts only what happened since it started', async () => {
  const state = createState()
  recordSummary(state, gain(0, 0, 0), null)
  recordSummary(state, gain(1, 1_240, 310), 'git status')
  startTurn(state)
  recordSummary(state, gain(2, 39_640, 6_210), 'cargo test')
  expect(turnTotals(state)).toEqual({ input: 38_400, output: 5_900, saved: 32_500 })
})

test('the shown values reach the totals in FRAMES steps and never overshoot', async () => {
  const state = createState()
  recordSummary(state, gain(0, 0, 0), null)
  recordSummary(state, gain(1, 48_200, 9_100), 'cargo test')
  let previous = 0
  for (let frame = 1; frame < FRAMES; frame++) {
    expect(step(state)).toBe(true)
    expect(state.shown.input >= previous).toBe(true)
    expect(state.shown.input <= 48_200).toBe(true)
    previous = state.shown.input
  }
  // The bars arrive on the last of their frames
  step(state)
  expect(state.shown).toEqual({ input: 48_200, output: 9_100 })
  expect(state.anim).toBe(null)
  // The viking's strike plays on to its own end, then everything stops
  let more = 0
  while (step(state)) more += 1
  expect(FRAMES + more + 1).toBe(VIKING_FRAMES)
})

test('a bar always has exactly its width in cells', async () => {
  expect(allocate([9_100, 39_100], 30).reduce((a, b) => a + b, 0)).toBe(30)
  expect(allocate([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
  expect(allocate([0, 0], 10)).toEqual([0, 0])
  // 0.1 % of 30 cells is no cell: the bar does not flatter a tiny share
  expect(allocate([999, 1], 30)).toEqual([30, 0])
})

test('the context bar keeps the biggest categories and folds the rest', async () => {
  const state = createState()
  const usage = {
    context: {
      tokens: 62_000,
      window: 200_000,
      breakdown: {
        categories: [
          { name: 'System prompt', tokens: 3_000, kind: 'used' },
          { name: 'System tools', tokens: 16_000, kind: 'used' },
          { name: 'Memory files', tokens: 2_000, kind: 'used' },
          { name: 'Skills', tokens: 1_000, kind: 'used' },
          { name: 'Messages', tokens: 40_000, kind: 'used' },
          { name: 'Free space', tokens: 105_000, kind: 'free' },
          { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
        ],
      },
    },
  }
  setContext(state, readUsage(usage))
  const view = contextView(state)
  expect(view.parts.map((part) => part.name)).toEqual(['Messages', 'System tools', 'System prompt', 'Memory files', null])
  expect(view.parts[4].tokens).toBe(1_000)
  expect(view.total).toBe(62_000)
  expect(view.window).toBe(200_000)
  // Every shown category has a color of its own
  const slots = view.parts.filter((part) => part.name).map((part) => part.slot)
  expect(new Set(slots).size).toBe(slots.length)
  expect(slots.every((slot) => slot >= 0 && slot < 4)).toBe(true)
})

test('a category keeps its color while the ranking changes', async () => {
  const state = createState()
  const usage = (rows: [string, number][]) => ({
    context: { tokens: 1, window: 200_000, breakdown: { categories: rows.map(([name, tokens]) => ({ name, tokens, kind: 'used' })) } },
  })
  setContext(state, readUsage(usage([['System tools', 28_000], ['Memory files', 14_000], ['Skills', 7_800], ['System prompt', 2_700]])))
  const before = Object.fromEntries(contextView(state).parts.map((part) => [part.name, part.slot]))

  // Messages grows into the top four and pushes System prompt out
  setContext(state, readUsage(usage([['System tools', 28_000], ['Messages', 22_600], ['Memory files', 14_000], ['Skills', 7_800], ['System prompt', 2_700]])))
  const parts = contextView(state).parts.filter((part) => part.name)
  const after = Object.fromEntries(parts.map((part) => [part.name, part.slot]))
  expect(after['System tools']).toBe(before['System tools'])
  expect(after['Memory files']).toBe(before['Memory files'])
  expect(after['Skills']).toBe(before['Skills'])
  // Messages takes the slot nobody shown holds any more
  expect(after['Messages']).toBe(before['System prompt'])
  expect(new Set(Object.values(after)).size).toBe(4)
})

test('without a breakdown the context is one part', async () => {
  const state = createState()
  setContext(state, readUsage({ context: { tokens: 62_000, window: 200_000 } }))
  expect(contextView(state).parts).toEqual([{ name: null, tokens: 62_000, slot: -1 }])
  expect(readUsage({})).toBe(null)
})

test('proxy rows since the session started become the proxy section', async () => {
  const row = { requests: 3, saved: 4_999, ccr: 0, ingest: 0, pixel: 4_999, ctx_total: 50_278, ctx_tool_result: 1_783, ctx_tool_use: 23, ctx_duplicate: 0 }
  const proxy = parseProxy(JSON.stringify([row]))
  expect(proxy.requests).toBe(3)
  expect(proxy.saved).toBe(4_999)
  expect(proxy.last).toEqual({ total: 50_278, toolResults: 1_783, toolArgs: 23, rest: 48_472, duplicates: 0 })
  // No request since the session started: the proxy is not in play
  expect(parseProxy(JSON.stringify([{ requests: 0 }]))).toBe(null)
  expect(parseProxy('')).toBe(null)

  const query = proxyQuery(Date.UTC(2026, 9, 5, 17, 21, 0))
  expect(query).toContain("ts >= '2026-10-05T17:21:00.000'")
})

test('the mode names what feeds the pane', async () => {
  const state = createState()
  expect(mode(state)).toBe('hookOnly')
  state.rtk = 'ok'
  state.proxy = { requests: 1 }
  expect(mode(state)).toBe('hookProxy')
  state.rtk = 'missing'
  expect(mode(state)).toBe('proxyOnly')
})
