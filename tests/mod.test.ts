import { expect, mock, test } from 'claude-code/testing'

const START = Date.UTC(2026, 9, 5, 17, 21, 0)

const gainJson = (commands: number, input: number, output: number) =>
  JSON.stringify({ summary: { total_commands: commands, total_input: input, total_output: output, total_saved: input - output } })

const USAGE = {
  context: {
    tokens: 62_000,
    window: 200_000,
    percent: 31,
    breakdown: {
      categories: [
        { name: 'System tools', tokens: 16_000, color: 'inactive', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 46_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 105_000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: 62_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
    },
  },
  rateLimits: [],
}

const site = (component: string, props: Record<string, unknown>, requestId?: string) => ({
  plugin: 'rtk-gain',
  component,
  requestId,
  surface: 'terminal' as const,
  viewport: { columns: 140, rows: 40 },
  props,
})

const BAND = site('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} })
const PANE = site(
  'Pane',
  { title: 'rtk', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  'rtk-gain',
)

type Options = {
  rtk?: 'missing'
  proxy?: Record<string, number>
  closed?: string[]
  surfaces?: string[]
  env?: Record<string, string>
  settings?: Record<string, unknown>
  system?: string
}

// Answers everything the mod asks Claude Code for. `readings` is what
// successive `rtk gain` calls print: the last one repeats.
function claudeCode(on: any, readings: string[], options: Options = {}) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, options.env ?? { HOME: '/home/dev', RTK_GAIN_LANG: 'fr' })
  let read = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: options.proxy !== undefined }))
  on('settings.read', () => ({ value: options.settings ?? {} }))
  on('process.run', ($: unknown, e: any) => {
    if (e.argv[0] === 'defaults') {
      return options.system ? { value: { exitCode: 0, stdout: options.system + '\n', stderr: '' } } : { deny: 'not macOS' }
    }
    if (e.argv[0] === 'sqlite3') {
      return { value: { exitCode: 0, stdout: JSON.stringify([options.proxy]), stderr: '' } }
    }
    if (options.rtk === 'missing') return { deny: 'rtk: command not found' }
    const stdout = readings[Math.min(read, readings.length - 1)]
    read += 1
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('session.usage', () => ({ value: USAGE }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  // Like Claude Code, answer with the answer itself
  on('turn.complete', ($: unknown, e: any) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', ($: unknown, e: any) => {
    options.closed?.push(e.id)
    return { value: undefined }
  })
  // What Claude Code itself draws at a site; the spinner echoes its suffix
  on('ui.render', ($: unknown, e: any) => ({ type: 'Text', props: {}, children: ['core' + (e.props?.suffix ?? '')] }))
  return clock
}

// Lets the read queued behind a tool call finish, then plays the animation out
async function settle(clock: any) {
  for (let frame = 0; frame < 20; frame++) await clock.advance(33)
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

test('the band shows the session savings once a command went through rtk', async ($, on) => {
  const clock = claudeCode(on, [gainJson(100, 50_000, 20_000), gainJson(101, 88_400, 25_900)])
  await start($)

  // Nothing went through rtk yet: the mod leaves the band to Claude Code
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'core' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'cargo test --all' })
  await settle(clock)

  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: '−85 %' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 38,4 k → 5,9 k · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · contexte 62,0 k (sans RTK 94,5 k)' })).toBeDefined()
  await ui.unmount()
})

test('/rtk-gain opens a pane with both bars and the last command', async ($, on) => {
  const clock = claudeCode(on, [gainJson(100, 50_000, 20_000), gainJson(101, 88_400, 25_900)])
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'cargo test --all' })
  await settle(clock)

  const answer = await $.command.run({ command: 'rtk-gain', args: '' })
  expect(answer).toEqual({})

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'hook seul' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '38,4 k prévus → 5,9 k utilisés' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '62,0 k / 200 k' })).toBeDefined()
    // Claude Code names the category in English; the pane translates it
    expect(await ui.find({ type: 'Text', text: 'messages' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'sans RTK : 94,5 k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▸ cargo test' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '38,4 k → 5,9 k  −85 %' })).toBeDefined()
    await ui.unmount()
  }
})

test('the bars move toward the new totals frame by frame', async ($, on) => {
  const clock = claudeCode(on, [gainJson(0, 0, 0), gainJson(1, 48_200, 9_100)])
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  // The queued read and three frames of twelve
  await clock.advance(33)
  await clock.advance(33)
  await clock.advance(33)
  await $.command.run({ command: 'rtk-gain', args: '' })

  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '48,2 k prévus → 9,1 k utilisés' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\d+,\d k prévus → \d+(,\d k)? utilisés$/ })).toBeDefined()
  await ui.unmount()

  await settle(clock)
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '48,2 k prévus → 9,1 k utilisés' })).toBeDefined()
  await ui.unmount()
})

test('the spinner and the line under the answer carry the gain', async ($, on) => {
  const clock = claudeCode(on, [gainJson(0, 0, 0), gainJson(1, 1_240, 310), gainJson(2, 39_640, 6_210)])
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await settle(clock)

  await $.turn.start({ turnId: 't2', text: 'run the tests' })
  await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  await settle(clock)

  const ui = await $.ui.mount(site('Spinner', { word: 'Thinking', message: '', suffix: '', mode: 'thinking' }, 'main'))
  expect(await ui.find({ type: 'Text', text: 'core · rtk −84 %' })).toBeDefined()
  await ui.unmount()

  const done = await $.turn.complete({ turnId: 't2', answer: 'Two tests fail.', durationMs: 1200, isAborted: false, usage: null })
  // Only this turn's command, not the session's
  expect(done.text).toBe('rtk : 38,4 k prévus → 5,9 k utilisés (−85 %) sur ce tour')
})

test('without rtk the mod draws nothing above the prompt and says why in the pane', async ($, on) => {
  const clock = claudeCode(on, [], { rtk: 'missing' })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await settle(clock)

  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'core' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'rtk-gain', args: '' })
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'rtk introuvable dans le PATH' })).toBeDefined()
  await ui.unmount()
})

test('rows the proxy wrote since the session started add its section', async ($, on) => {
  const proxy = { requests: 3, saved: 4_999, ccr: 0, ingest: 0, pixel: 4_999, ctx_total: 50_278, ctx_tool_result: 1_783, ctx_tool_use: 23, ctx_duplicate: 0 }
  const clock = claudeCode(on, [gainJson(0, 0, 0), gainJson(1, 1_240, 310)], { proxy })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await settle(clock)
  await $.command.run({ command: 'rtk-gain', args: '' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'hook + proxy' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'PROXY' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5,0 k retiré' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'sorties d’outils' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'images 5,0 k' })).toBeDefined()
  await ui.unmount()
})

test('/rtk-gain a second time closes the pane', async ($, on) => {
  const closed: string[] = []
  claudeCode(on, [gainJson(0, 0, 0)], { closed })
  await start($)
  await $.command.run({ command: 'rtk-gain', args: '' })
  expect(closed).toEqual([])
  await $.command.run({ command: 'rtk-gain', args: '' })
  expect(closed).toEqual(['rtk-gain'])
})

test('where nothing draws, /rtk-gain answers in text', async ($, on) => {
  // /rtk-gain reads rtk again itself, so the baseline is printed twice
  const clock = claudeCode(on, [gainJson(0, 0, 0), gainJson(0, 0, 0), gainJson(1, 48_200, 9_100)], { surfaces: [] })
  await start($)
  expect((await $.command.run({ command: 'rtk-gain', args: '' })).text).toBe('aucune commande passée par rtk dans cette session')

  await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  await settle(clock)
  expect((await $.command.run({ command: 'rtk-gain', args: '' })).text).toBe('48,2 k prévus → 9,1 k utilisés (−81 %)')
})
