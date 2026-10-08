// Session state and everything derived from it. Pure: no mods API in this file.

import { advanceViking, pickAttack, pickEffect } from './viking.js'

// Frames of one animation: 12 frames at 33 ms is 0.4 s.
export const FRAMES = 12
export const MAX_COMMANDS = 5
export const MAX_CATEGORIES = 4

export function createState() {
  return {
    lang: 'fr',
    startedAt: 0,
    // 'unknown' until the first read, then 'ok' or 'missing'
    rtk: 'unknown',
    // Absolute `rtk gain` totals: at session start, and at the last read
    base: null,
    last: null,
    // Session totals when the current turn started
    turnBase: { input: 0, output: 0 },
    // Newest first: { name, input, output, count }
    commands: [],
    running: null,
    // { tokens, window, categories: [{ name, tokens }] }
    context: null,
    // Color slot of each context category, so a category keeps its color
    slotOf: {},
    // What the proxy recorded since the session started, or null
    proxy: null,
    // What the bars show now, on its way to the session totals
    shown: { input: 0, output: 0 },
    anim: null,
    // The viking's strike on the last command:
    // { frame, name, input, output, attack, effect }
    viking: null,
    showViking: true,
    // The attack chosen when a command starts, so he readies the right weapon
    nextAttack: null,
    // An attack or an effect pinned by RTK_GAIN_ANIMATION
    fixed: {},
    random: Math.random,
    paneOpen: false,
  }
}

// `rtk gain --format json` -> { commands, input, output }, or null when unreadable
export function parseSummary(stdout) {
  try {
    const summary = JSON.parse(stdout).summary
    const input = Number(summary.total_input)
    const output = Number(summary.total_output)
    const commands = Number(summary.total_commands)
    if (![input, output, commands].every(Number.isFinite)) return null
    return { commands, input, output }
  } catch {
    return null
  }
}

// What RTK did since the session started
export function sessionTotals(state) {
  if (!state.base || !state.last) return { commands: 0, input: 0, output: 0, saved: 0 }
  const input = Math.max(0, state.last.input - state.base.input)
  const output = Math.max(0, state.last.output - state.base.output)
  return {
    commands: Math.max(0, state.last.commands - state.base.commands),
    input,
    output,
    saved: Math.max(0, input - output),
  }
}

// Takes a fresh absolute summary. Returns what changed since the previous one,
// or null when nothing did. The first summary of a session is the baseline.
export function recordSummary(state, summary, commandName) {
  state.rtk = 'ok'
  if (!state.base) {
    state.base = summary
    state.last = summary
    return null
  }
  const previous = state.last
  // Totals that went down mean the history was cleared: start again from here
  if (summary.input < previous.input || summary.commands < previous.commands) {
    state.base = summary
    state.last = summary
    state.commands = []
    state.turnBase = { input: 0, output: 0 }
    state.shown = { input: 0, output: 0 }
    state.anim = null
    return null
  }
  const delta = {
    commands: summary.commands - previous.commands,
    input: summary.input - previous.input,
    output: summary.output - previous.output,
  }
  state.last = summary
  // No tokens went through rtk: nothing to show, even when rtk counted the
  // command itself (a passthrough it logs with no output)
  if (delta.input <= 0) return null
  state.commands.unshift({
    name: commandName || 'rtk',
    input: delta.input,
    output: delta.output,
    count: delta.commands,
  })
  state.commands = state.commands.slice(0, MAX_COMMANDS)
  state.anim = { from: { ...state.shown }, frame: 0 }
  if (delta.input > 0) {
    const savedRatio = (delta.input - delta.output) / delta.input
    state.viking = {
      frame: 0,
      name: commandName || 'rtk',
      input: delta.input,
      output: delta.output,
      attack: state.nextAttack ?? state.fixed.attack ?? pickAttack(state.viking?.attack, state.random),
      effect: state.fixed.effect ?? pickEffect(state.viking?.effect, savedRatio, state.random),
    }
    state.nextAttack = null
  }
  return delta
}

export function startTurn(state) {
  const totals = sessionTotals(state)
  state.turnBase = { input: totals.input, output: totals.output }
}

export function turnTotals(state) {
  const totals = sessionTotals(state)
  const input = Math.max(0, totals.input - state.turnBase.input)
  const output = Math.max(0, totals.output - state.turnBase.output)
  return { input, output, saved: Math.max(0, input - output) }
}

// A command starts: choose the attack now, never the one just played
export function prepareStrike(state) {
  state.nextAttack = state.fixed.attack ?? pickAttack(state.viking?.attack, state.random)
}

// One frame of every animation. Returns true while one has frames left.
export function step(state) {
  const viking = advanceViking(state)
  const bars = stepBars(state)
  return viking || bars
}

// Moves the shown values one frame toward the session totals.
// Returns true while there is another frame to draw.
function stepBars(state) {
  const target = sessionTotals(state)
  if (!state.anim) {
    state.shown = { input: target.input, output: target.output }
    return false
  }
  state.anim.frame += 1
  const progress = Math.min(1, state.anim.frame / FRAMES)
  const eased = 1 - (1 - progress) ** 3
  const from = state.anim.from
  state.shown = {
    input: from.input + (target.input - from.input) * eased,
    output: from.output + (target.output - from.output) * eased,
  }
  if (progress >= 1) {
    state.shown = { input: target.input, output: target.output }
    state.anim = null
    return false
  }
  return true
}

// Splits `width` cells between `values` in proportion, by largest remainder.
// A share too small for a cell gets none: the number beside the bar stays exact.
export function allocate(values, width) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (!(total > 0) || width <= 0) return values.map(() => 0)
  const exact = values.map((value) => (Math.max(0, value) / total) * width)
  const cells = exact.map(Math.floor)
  let left = width - cells.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
  for (const { index } of order) {
    if (left <= 0) break
    cells[index] += 1
    left -= 1
  }
  return cells
}

// `$.session.usage({ breakdown })` -> { tokens, window, categories }
export function readUsage(usage) {
  const context = usage?.context
  if (!context || !(context.window > 0)) return null
  const rows = context.breakdown?.categories ?? []
  const categories = rows
    .filter((row) => row.kind === 'used' && row.tokens > 0)
    .map((row) => ({ name: String(row.name), tokens: Number(row.tokens) }))
  const fromRows = categories.reduce((sum, row) => sum + row.tokens, 0)
  return {
    tokens: Number(context.tokens ?? 0) || fromRows,
    window: Number(context.window),
    categories,
  }
}

export function setContext(state, context) {
  if (!context) return
  state.context = context
}

// Gives each shown category a slot of its own. A category keeps the slot it
// had while no other shown category holds it; a new one takes a free slot.
function assignSlots(state, names) {
  const taken = new Set()
  const keep = names.filter((name) => {
    const slot = state.slotOf[name]
    if (slot === undefined || taken.has(slot)) return false
    taken.add(slot)
    return true
  })
  for (const name of names) {
    if (keep.includes(name)) continue
    let slot = 0
    while (taken.has(slot)) slot += 1
    state.slotOf[name] = slot
    taken.add(slot)
  }
}

// The context bar: the biggest categories, the rest folded into one part,
// and what RTK kept out of the window.
export function contextView(state) {
  const avoided = Math.max(0, state.shown.input - state.shown.output)
  if (!state.context) return { parts: [], total: 0, window: 0, avoided }
  const { tokens, window, categories } = state.context
  const sorted = [...categories].sort((a, b) => b.tokens - a.tokens)
  const shown = sorted.slice(0, MAX_CATEGORIES)
  assignSlots(state, shown.map((row) => row.name))
  const parts = shown.map((row) => ({ name: row.name, tokens: row.tokens, slot: state.slotOf[row.name] }))
  const folded = sorted.slice(MAX_CATEGORIES).reduce((sum, row) => sum + row.tokens, 0)
  if (folded > 0) parts.push({ name: null, tokens: folded, slot: -1 })
  // No breakdown from this version of Claude Code: one part for the whole window
  if (parts.length === 0 && tokens > 0) parts.push({ name: null, tokens, slot: -1 })
  return { parts, total: tokens, window, avoided }
}

// One SELECT over the proxy's `usage_records`: totals since the session started,
// and the context breakdown of the latest request. Only columns that every
// proxy schema has (the OSS daemon and the Pro one).
export function proxyQuery(startedAtMs) {
  const since = new Date(Number(startedAtMs) || 0).toISOString().replace('Z', '')
  return [
    `with w as (select * from usage_records where ts >= '${since}'),`,
    'l as (select * from w where ctx_total > 0 order by id desc limit 1)',
    'select (select count(*) from w) as requests,',
    '(select coalesce(sum(tokens_saved), 0) from w) as saved,',
    '(select coalesce(sum(saved_ccr), 0) from w) as ccr,',
    '(select coalesce(sum(saved_ingest_filter), 0) from w) as ingest,',
    '(select coalesce(sum(saved_pixel_compress), 0) from w) as pixel,',
    '(select ctx_total from l) as ctx_total,',
    '(select ctx_tool_result from l) as ctx_tool_result,',
    '(select ctx_tool_use from l) as ctx_tool_use,',
    '(select ctx_duplicate from l) as ctx_duplicate',
  ].join(' ')
}

// One row of `sqlite3 -json` over the proxy's usage_records -> proxy view, or null
export function parseProxy(stdout) {
  try {
    const row = JSON.parse(stdout)[0]
    const requests = Number(row.requests)
    if (!(requests > 0)) return null
    const number = (value) => Number(value) || 0
    const total = number(row.ctx_total)
    const toolResults = number(row.ctx_tool_result)
    const toolArgs = number(row.ctx_tool_use)
    return {
      requests,
      saved: number(row.saved),
      stages: { ccr: number(row.ccr), filter: number(row.ingest), pixels: number(row.pixel) },
      last: total > 0
        ? {
            total,
            toolResults,
            toolArgs,
            rest: Math.max(0, total - toolResults - toolArgs),
            duplicates: number(row.ctx_duplicate),
          }
        : null,
    }
  } catch {
    return null
  }
}

export function mode(state) {
  if (state.proxy && state.rtk === 'ok') return 'hookProxy'
  if (state.proxy) return 'proxyOnly'
  return 'hookOnly'
}
