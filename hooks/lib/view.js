// Element trees for each place the mod draws in. Pure: the hooks module passes
// in the elements it got from `$.ui.resolve(e)`.

import { percent, tokens } from './format.js'
import { categoryName, fill, messages } from './i18n.js'
import { BLOCK, BLOCK_X, runs, vikingGrid } from './viking.js'
import { allocate, contextView, mode, sessionTotals, turnTotals } from './model.js'

// Steps validated against a dark surface (dataviz palette): two hues for the
// commands bar, a fixed order for context categories, a neutral for the rest.
// The categories leave out the commands bar's blue and green, so no color
// means two things in one pane.
export const COLORS = {
  used: '#3987e5',
  saved: '#199e70',
  rest: '#6b6a65',
  slots: ['#d95926', '#9085e9', '#c98500', '#d55181'],
}

const FULL = '█'
const HATCH = '╱'
const EMPTY = '░'
const MARK = '■'

function colorOf(part) {
  return part.slot < 0 ? COLORS.rest : COLORS.slots[part.slot % COLORS.slots.length]
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

// One row of colored cells. Each segment is { value, color, char }.
function bar({ Box, Text }, segments, width) {
  const cells = allocate(segments.map((segment) => segment.value), width)
  const children = []
  segments.forEach((segment, index) => {
    if (cells[index] > 0) {
      children.push(Text({ color: segment.color, children: [(segment.char ?? FULL).repeat(cells[index])] }))
    }
  })
  if (children.length === 0) children.push(Text({ dimColor: true, children: [EMPTY.repeat(width)] }))
  return Box({ flexDirection: 'row', children })
}

function row({ Box }, left, right) {
  return Box({ flexDirection: 'row', justifyContent: 'space-between', children: [left, right] })
}

function legend(el, color, mark, label, value) {
  const { Box, Text } = el
  return row(
    el,
    Box({ flexDirection: 'row', children: [Text({ color, children: [mark + ' '] }), Text({ children: [label] })] }),
    Text({ bold: true, children: [value] }),
  )
}

function commandsBar(el, state, width) {
  const { input, output } = state.shown
  return bar(
    el,
    [
      { value: output, color: COLORS.used },
      { value: Math.max(0, input - output), color: COLORS.saved },
    ],
    width,
  )
}

function proxySection(el, state, width) {
  const { Text } = el
  const t = messages(state.lang)
  const proxy = state.proxy
  const children = [
    Text({ children: [' '] }),
    row(
      el,
      Text({ dimColor: true, children: [t.proxy] }),
      Text({ bold: true, children: [fill(t.removed, { n: tokens(proxy.saved, state.lang) })] }),
    ),
  ]
  if (proxy.last) {
    const last = proxy.last
    children.push(
      bar(
        el,
        [
          { value: last.toolResults, color: COLORS.slots[0] },
          { value: last.toolArgs, color: COLORS.slots[1] },
          { value: last.rest, color: COLORS.rest },
        ],
        width,
      ),
      legend(el, COLORS.slots[0], MARK, t.toolResults, tokens(last.toolResults, state.lang)),
      legend(el, COLORS.slots[1], MARK, t.toolArgs, tokens(last.toolArgs, state.lang)),
      legend(el, COLORS.rest, MARK, t.rest, tokens(last.rest, state.lang)),
    )
    if (last.duplicates > 0) {
      children.push(Text({ dimColor: true, children: [fill(t.duplicates, { n: tokens(last.duplicates, state.lang) })] }))
    }
  }
  const stages = Object.entries(proxy.stages)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => (t.stages[name] ?? name) + ' ' + tokens(value, state.lang))
  if (stages.length > 0) children.push(Text({ dimColor: true, children: [stages.join(' · ')] }))
  return children
}

// The viking at the top of the pane, in the terminal only: the Desktop app's
// text need not be monospaced, and the drawing would come apart there.
const VIKING_COLORS = {
  used: [COLORS.used, '#2f6fc0'],
  saved: [COLORS.saved, '#13845d'],
  idle: ['#4a4a46', '#3d3d3a'],
}

function vikingRows(el, state, width) {
  const { Box, Text } = el
  const anim = state.viking
  const label = state.running
    ? '▸ ' + state.running
    : anim
      ? anim.name + '  ' + percent(anim.input, anim.output, state.lang)
      : ' '
  const rows = runs(vikingGrid(state, width, VIKING_COLORS)).map((row) =>
    Box({
      flexDirection: 'row',
      children: row.map((run) =>
        Text({
          ...(run.color ? { color: run.color } : {}),
          ...(run.background ? { backgroundColor: run.background } : {}),
          children: [run.text],
        }),
      ),
    }),
  )
  return Box({
    key: 'viking',
    flexDirection: 'column',
    children: [Box({ flexDirection: 'row', paddingLeft: BLOCK_X, children: [Text({ bold: true, children: [label] })] }), ...rows],
  })
}

// The pane beside the transcript: the viking, both bars, their legends, the last commands.
export function paneTree(el, state, columns, surface = 'terminal') {
  const { Box, Text } = el
  const lang = state.lang
  const t = messages(lang)
  const width = clamp(columns - 2, 16, 56)
  const { input, output } = state.shown
  const dim = (text) => Text({ dimColor: true, children: [text] })
  const blank = () => Text({ children: [' '] })

  const children = [row(el, Text({ bold: true, children: [t.title] }), dim(t[mode(state)]))]
  if (state.showViking && surface === 'terminal' && width >= BLOCK_X + BLOCK + 1) {
    children.push(blank(), vikingRows(el, state, Math.min(width, 50)))
  }
  if (state.rtk === 'missing') children.push(Text({ color: 'yellow', children: [t.noRtk] }))

  children.push(
    row(el, dim(t.commands), Text({ bold: true, children: [percent(input, output, lang)] })),
    commandsBar(el, state, width),
    dim(fill(t.plannedUsed, { planned: tokens(input, lang), used: tokens(output, lang) })),
  )

  const view = contextView(state)
  if (view.total > 0) {
    children.push(
      blank(),
      row(
        el,
        dim(t.context),
        Text({ bold: true, children: [tokens(view.total, lang) + ' / ' + tokens(view.window, lang)] }),
      ),
      bar(
        el,
        [
          ...view.parts.map((part) => ({ value: part.tokens, color: colorOf(part) })),
          { value: view.avoided, color: COLORS.saved, char: HATCH },
        ],
        width,
      ),
    )
    for (const part of view.parts) {
      children.push(legend(el, colorOf(part), MARK, part.name ? categoryName(lang, part.name) : t.other, tokens(part.tokens, lang)))
    }
    if (view.avoided > 0) {
      children.push(
        legend(el, COLORS.saved, HATCH, t.avoided, tokens(view.avoided, lang)),
        dim(fill(t.withoutRtk, { n: tokens(view.total + view.avoided, lang) })),
      )
    }
  }

  if (state.proxy) children.push(...proxySection(el, state, width))

  children.push(blank(), dim(t.lastCommands))
  if (state.running) {
    children.push(row(el, Text({ bold: true, children: ['▸ ' + state.running] }), dim(t.running)))
  }
  state.commands.forEach((command, index) => {
    const name = command.count > 1 ? command.name + ' +' + (command.count - 1) : command.name
    const figures =
      tokens(command.input, lang) + ' → ' + tokens(command.output, lang) + '  ' + percent(command.input, command.output, lang)
    const newest = index === 0 && !state.running
    children.push(row(el, Text({ bold: newest, children: [(newest ? '▸ ' : '  ') + name] }), dim(figures)))
  })
  if (state.commands.length === 0 && !state.running) children.push(dim(t.waiting))
  children.push(blank(), dim(t.estimated))

  return Box({ flexDirection: 'column', paddingX: 1, children })
}

// The band above the prompt: one line, or null while there is nothing to show.
export function bandTree(el, state, columns) {
  const { Box, Text } = el
  const lang = state.lang
  const t = messages(lang)
  if (sessionTotals(state).input <= 0) return null
  const { input, output } = state.shown
  const children = [
    Text({ bold: true, children: ['rtk '] }),
    commandsBar(el, state, columns >= 60 ? 16 : 8),
    Text({ children: [' ' + tokens(input, lang) + ' → ' + tokens(output, lang) + ' · '] }),
    Text({ bold: true, children: [percent(input, output, lang)] }),
  ]
  const view = contextView(state)
  if (columns >= 84 && view.total > 0) {
    const without = tokens(view.total + view.avoided, lang)
    children.push(
      Text({
        dimColor: true,
        children: [' · ' + fill(t.bandContext, { n: tokens(view.total, lang), m: without })],
      }),
    )
  }
  if (state.running && columns >= 110) {
    children.push(Text({ dimColor: true, children: [' · ▸ ' + state.running] }))
  }
  return Box({ flexDirection: 'row', paddingX: 1, children })
}

// Added after the spinner's word while Claude works
export function spinnerSuffix(state) {
  if (sessionTotals(state).input <= 0) return ''
  // The animated values, so the spinner and the bars agree on every frame
  return ' · rtk ' + percent(state.shown.input, state.shown.output, state.lang)
}

// The line under an answer: what RTK did during that turn
export function turnLine(state) {
  const turn = turnTotals(state)
  if (turn.input <= 0) return ''
  const t = messages(state.lang)
  const lang = state.lang
  return fill(t.turnLine, {
    planned: tokens(turn.input, lang),
    used: tokens(turn.output, lang),
    pct: percent(turn.input, turn.output, lang),
  })
}

// The text reply of /rtk-gain where no pane can be drawn
export function summaryLine(state) {
  const t = messages(state.lang)
  const lang = state.lang
  if (state.rtk === 'missing') return t.noRtk
  const totals = sessionTotals(state)
  if (totals.input <= 0) return t.noData
  return fill(t.summary, {
    planned: tokens(totals.input, lang),
    used: tokens(totals.output, lang),
    pct: percent(totals.input, totals.output, lang),
  })
}
