import { expect, mock, test } from 'claude-code/testing'

import { percent, tokens } from '../hooks/lib/format.js'
import { LANGUAGES, MESSAGES, NUMBER_STYLE, categoryName, detectLanguage, fill, languageOf, messages } from '../hooks/lib/i18n.js'

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(' ')

test('eight languages, each with every message and the same placeholders', async () => {
  expect(LANGUAGES).toEqual(['en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt'])
  const english = MESSAGES.en
  for (const lang of LANGUAGES) {
    const table = MESSAGES[lang]
    expect(Object.keys(table).sort()).toEqual(Object.keys(english).sort())
    expect(NUMBER_STYLE[lang]).toBeDefined()
    for (const [key, text] of Object.entries(english)) {
      if (typeof text !== 'string') continue
      expect(typeof table[key]).toBe('string')
      expect(table[key].length > 0).toBe(true)
      // A translation that drops or renames a placeholder would print "{n}"
      expect(placeholders(table[key])).toBe(placeholders(text))
    }
    expect(Object.keys(table.stages).sort()).toEqual(['ccr', 'filter', 'pixels'])
    if (lang !== 'en') {
      expect(Object.keys(table.categories).sort()).toEqual(
        ['Custom agents', 'MCP tools', 'Memory files', 'Messages', 'Skills', 'System prompt', 'System tools'],
      )
    }
  }
})

test('languages are recognized by code, locale and name', async () => {
  expect(languageOf('fr')).toBe('fr')
  expect(languageOf('fr_FR.UTF-8')).toBe('fr')
  expect(languageOf('zh-Hans-CN')).toBe('zh')
  expect(languageOf('pt_BR')).toBe('pt')
  expect(languageOf('Spanish')).toBe('es')
  expect(languageOf('español')).toBe('es')
  expect(languageOf('العربية')).toBe('ar')
  expect(languageOf('हिन्दी')).toBe('hi')
  expect(languageOf('Bangla')).toBe('bn')
  expect(languageOf('中文')).toBe('zh')
  expect(languageOf('C.UTF-8')).toBe(null)
  expect(languageOf('POSIX')).toBe(null)
  expect(languageOf('japanese')).toBe(null)
  expect(languageOf(undefined)).toBe(null)
})

test('the first source that names a supported language wins', async () => {
  expect(detectLanguage({})).toBe('en')
  expect(detectLanguage({ lang: 'C.UTF-8', system: 'fr_FR' })).toBe('fr')
  expect(detectLanguage({ lang: 'pt_BR.UTF-8', system: 'fr_FR' })).toBe('pt')
  expect(detectLanguage({ setting: 'spanish', lang: 'pt_BR.UTF-8' })).toBe('es')
  expect(detectLanguage({ explicit: 'ar', setting: 'spanish' })).toBe('ar')
  // A language the mod has no text for falls through to the next source
  expect(detectLanguage({ setting: 'japanese', lang: 'hi_IN' })).toBe('hi')
})

test('numbers follow each language', async () => {
  expect(tokens(48_200, 'en')).toBe('48.2k')
  expect(tokens(48_200, 'fr')).toBe('48,2 k')
  expect(tokens(48_200, 'es')).toBe('48,2k')
  expect(tokens(48_200, 'pt')).toBe('48,2k')
  expect(tokens(48_200, 'zh')).toBe('48.2k')
  expect(percent(100, 19, 'es')).toBe('−81 %')
  expect(percent(100, 19, 'pt')).toBe('−81%')
  expect(percent(100, 19, 'ar')).toBe('−81%')
})

test('templates are filled and categories translated', async () => {
  expect(fill(messages('fr').withoutRtk, { n: '103 k' })).toBe('sans RTK : 103 k')
  expect(fill(messages('en').withoutRtk, { n: '103k' })).toBe('without RTK: 103k')
  expect(fill(messages('zh').turnLine, { planned: '34.8k', used: '8.5k', pct: '−75%' })).toBe('rtk：本轮预计 34.8k → 实际 8.5k（−75%）')
  expect(categoryName('es', 'Memory files')).toBe('archivos de memoria')
  expect(categoryName('en', 'Memory files')).toBe('Memory files')
  // A category Claude Code adds later keeps its own name
  expect(categoryName('fr', 'Something new')).toBe('Something new')
  expect(messages('xx')).toBe(MESSAGES.en)
})

const gainJson = (commands: number, input: number, output: number) =>
  JSON.stringify({ summary: { total_commands: commands, total_input: input, total_output: output } })

const USAGE = {
  context: {
    tokens: 62_000,
    window: 200_000,
    breakdown: { categories: [{ name: 'Messages', tokens: 62_000, kind: 'used', color: 'promptBorder', isDeferred: false }] },
  },
  rateLimits: [],
}

const PANE = {
  plugin: 'rtk-gain',
  component: 'Pane',
  requestId: 'rtk-gain',
  surface: 'terminal' as const,
  viewport: { columns: 140, rows: 40 },
  props: { title: 'rtk', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

function claudeCode(on: any, env: Record<string, string>, extra: { settings?: Record<string, unknown>; system?: string } = {}) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, env)
  // At session start, then after the command
  const readings = [gainJson(0, 0, 0), gainJson(1, 48_200, 9_100)]
  let read = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: extra.settings ?? {} }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', ($: unknown, e: any) => {
    if (e.argv[0] === 'defaults') {
      return extra.system ? { value: { exitCode: 0, stdout: extra.system + '\n', stderr: '' } } : { deny: 'not macOS' }
    }
    const stdout = readings[Math.min(read, readings.length - 1)]
    read += 1
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('session.usage', () => ({ value: USAGE }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['core'] }))
  return clock
}

// What each language prints for the same session: 48.2k planned, 9.1k used
const EXPECTED: Record<string, string[]> = {
  en: ['rtk · session', '48.2k planned → 9.1k used', 'Messages', 'without RTK: 101k'],
  zh: ['rtk · 会话', '预计 48.2k → 实际 9.1k', '消息', '不用 RTK：101k'],
  hi: ['rtk · सत्र', '48.2k अनुमानित → 9.1k उपयोग', 'संदेश', 'RTK के बिना: 101k'],
  es: ['rtk · sesión', '48,2k previstos → 9,1k usados', 'mensajes', 'sin RTK: 101k'],
  ar: ['rtk · الجلسة', '48.2k متوقع → 9.1k مستخدم', 'الرسائل', 'بدون RTK: 101k'],
  fr: ['rtk · session', '48,2 k prévus → 9,1 k utilisés', 'messages', 'sans RTK : 101 k'],
  bn: ['rtk · সেশন', '48.2k প্রত্যাশিত → 9.1k ব্যবহৃত', 'বার্তা', 'RTK ছাড়া: 101k'],
  pt: ['rtk · sessão', '48,2k previstos → 9,1k usados', 'mensagens', 'sem RTK: 101k'],
}

for (const lang of Object.keys(EXPECTED)) {
  test(`the pane speaks ${lang}`, async ($, on) => {
    const clock = claudeCode(on, { HOME: '/home/dev', RTK_GAIN_LANG: lang })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Bash', command: 'cargo test' })
    for (let frame = 0; frame < 20; frame++) await clock.advance(33)
    await $.command.run({ command: 'rtk-gain', args: '' })
    const ui = await $.ui.mount(PANE)
    for (const text of EXPECTED[lang]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  })
}

test("Claude Code's language setting picks the language", async ($, on) => {
  claudeCode(on, { HOME: '/home/dev', LANG: 'en_US.UTF-8' }, { settings: { language: 'portuguese' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'rtk-gain', args: '' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'rtk · sessão' })).toBeDefined()
})

test('with LANG=C.UTF-8 on a Mac, the system language decides', async ($, on) => {
  claudeCode(on, { HOME: '/home/dev', LANG: 'C.UTF-8' }, { system: 'fr_FR' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'rtk-gain', args: '' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'COMMANDES' })).toBeDefined()
})

test('with nothing to go on, English', async ($, on) => {
  claudeCode(on, { HOME: '/home/dev' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'rtk-gain', args: '' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'COMMANDS' })).toBeDefined()
})
