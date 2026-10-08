// rtk-gain: RTK's token savings, live in Claude Code.
//
// tool.call (Bash): mark the command as running; when it returns, re-read
//   `rtk gain` and animate the bars toward the new totals.
// turn.start / turn.complete: per-turn totals, shown as a line under the answer.
// ui.render: a pane (/rtk-gain), one line above the prompt, the spinner's suffix.
//
// Claude Code reads on(...) and $.namespace.method(...) from this source, so
// both are spelled out here; everything that needs no `$` lives in ./lib.

import { shortCommand } from './lib/format.js'
import { detectLanguage, languageOf, messages } from './lib/i18n.js'
import {
  createState,
  parseProxy,
  parseSummary,
  prepareStrike,
  proxyQuery,
  readUsage,
  recordSummary,
  setContext,
  startTurn,
  step,
} from './lib/model.js'
import { bandTree, paneTree, spinnerSuffix, summaryLine, turnLine } from './lib/view.js'
import { parseAnimation } from './lib/viking.js'

const PANE = 'rtk-gain'
const FRAME_MS = 33
const READ_TIMEOUT_MS = 3000

let state = createState()
let ticker = null
let proxyDb = null
// Reads run one after the other, so two commands that end together can't
// record their totals out of order
let reads = Promise.resolve()

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setup($)
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const name = shortCommand(e.command)
    prepareStrike(state)
    state.running = name
    $.ui.invalidate('ui.render')
    try {
      return await next(e)
    } finally {
      state.running = null
      // Off the tool call's path: Claude gets the result without waiting for rtk
      $.clock.after(0, () => enqueue($, name))
    }
  })

  on('turn.start', async ($, e, next) => {
    startTurn(state)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn ends inside the main one, which reports for both
    if (e.agentId) return result
    await enqueue($, null)
    const line = turnLine(state)
    if (!line) return result
    // Core answers with the answer itself; any other text is shown beneath it.
    // Keep a line another mod added, and put ours after it.
    const other = result?.text && result.text !== e.answer ? result.text + '\n' : ''
    return { ...result, text: other + line }
  })

  on('command.run', { command: 'rtk-gain' }, async ($) => {
    if (state.paneOpen) {
      state.paneOpen = false
      await $.ui.close({ id: PANE })
      return {}
    }
    await enqueue($, null)
    // Nothing draws in a plain `claude -p` run, where an opened pane still
    // counts as placed: answer in text there
    const surfaces = await $.session.surfaces()
    if (surfaces.length === 0) return { text: summaryLine(state) }
    const pane = await $.ui.open({ id: PANE, title: messages(state.lang).paneTitle, closeOnEscape: true })
    state.paneOpen = pane?.isPlaced === true
    return state.paneOpen ? {} : { text: summaryLine(state) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) state.paneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return paneTree($.ui.resolve(e), state, e.props?.bodyColumns ?? 40, e.surface)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props?.hasSurvey) return next(e)
    const band = bandTree($.ui.resolve(e), state, e.props?.bodyColumns ?? 80)
    return band ?? next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const suffix = spinnerSuffix(state)
    if (!suffix) return next(e)
    return next({ ...e, props: { ...e.props, suffix: (e.props?.suffix ?? '') + suffix } })
  })
}

async function setup($) {
  if (ticker) ticker.cancel()
  ticker = null
  state = createState()
  try {
    state.lang = await readLanguage($)
    state.showViking = (await $.env.get('RTK_GAIN_VIKING')) !== '0'
    state.fixed = parseAnimation(await $.env.get('RTK_GAIN_ANIMATION'))
    state.startedAt = await $.clock.now()
    await $.command.register({
      name: 'rtk-gain',
      description: messages(state.lang).commandDescription,
      immediate: true,
    })
    proxyDb = await findProxyDb($)
  } catch {
    // A missing answer here leaves the defaults in place
  }
  await enqueue($, null)
}

// RTK_GAIN_LANG, then Claude Code's `language` setting, then the locale, then
// the macOS system language (LANG is often C.UTF-8 there), then English
async function readLanguage($) {
  let setting = null
  try {
    const settings = await $.settings.read()
    setting = settings.language
  } catch {
    // No settings: the next sources decide
  }
  const sources = {
    explicit: await $.env.get('RTK_GAIN_LANG'),
    setting,
    lcAll: await $.env.get('LC_ALL'),
    lcMessages: await $.env.get('LC_MESSAGES'),
    lang: await $.env.get('LANG'),
  }
  if (!Object.values(sources).some(languageOf)) {
    sources.system = await readSystemLocale($)
  }
  return detectLanguage(sources)
}

async function readSystemLocale($) {
  try {
    const run = await $.process.run(['defaults', 'read', '-g', 'AppleLocale'], { timeoutMs: 1000 })
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    // Not macOS
    return null
  }
}

function enqueue($, name) {
  reads = reads.then(() => refresh($, name)).catch(() => {})
  return reads
}

async function refresh($, name) {
  const summary = await readGain($)
  if (summary && recordSummary(state, summary, name)) animate($)
  setContext(state, await readContext($))
  state.proxy = await readProxy($)
  $.ui.invalidate('ui.render')
}

// The session's totals come from rtk itself: the mod sees a command before the
// rtk hook rewrites it, and only its filtered output afterwards.
async function readGain($) {
  try {
    const run = await $.process.run(['rtk', 'gain', '--format', 'json', '--project'], { timeoutMs: READ_TIMEOUT_MS })
    return run.exitCode === 0 ? parseSummary(run.stdout) : null
  } catch {
    state.rtk = 'missing'
    return null
  }
}

async function readContext($) {
  try {
    return readUsage(await $.session.usage({ breakdown: 'summary' }))
  } catch {
    return null
  }
}

// The rtk proxy keeps one row per request in SQLite. Until the daemon exposes
// a per-session endpoint, read the rows written since this session started.
async function readProxy($) {
  if (!proxyDb) return null
  try {
    const run = await $.process.run(
      ['sqlite3', '-json', 'file:' + proxyDb.replace(/[%?#]/g, encodeURIComponent) + '?mode=ro', proxyQuery(state.startedAt)],
      { timeoutMs: READ_TIMEOUT_MS },
    )
    return run.exitCode === 0 ? parseProxy(run.stdout) : null
  } catch {
    return null
  }
}

async function findProxyDb($) {
  const chosen = await $.env.get('RTK_PROXY_DB')
  if (chosen) return chosen
  const home = await $.env.get('HOME')
  const config = await $.env.get('XDG_CONFIG_HOME')
  const candidates = [
    home && home + '/Library/Application Support/rtk/llm-proxy/rtk-proxy.db',
    config && config + '/rtk/llm-proxy/rtk-proxy.db',
    home && home + '/.config/rtk/llm-proxy/rtk-proxy.db',
  ]
  for (const path of candidates) {
    if (path && (await $.fs.exists(path))) return path
  }
  return null
}

function animate($) {
  if (ticker) return
  ticker = $.clock.every(FRAME_MS, () => {
    const more = step(state)
    $.ui.invalidate('ui.render')
    if (!more && ticker) {
      ticker.cancel()
      ticker = null
    }
  })
}
