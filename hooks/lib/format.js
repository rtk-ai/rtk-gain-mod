// Number and command formatting. Pure: no mods API in this file.

import { NUMBER_STYLE } from './i18n.js'

const MINUS = '−'

function style(lang) {
  return NUMBER_STYLE[lang] ?? NUMBER_STYLE.en
}

// 310 -> "310", 48200 -> "48.2k" (en) or "48,2 k" (fr), 1240000 -> "1.24M"
export function tokens(n, lang = 'en') {
  const value = Math.max(0, Math.round(n))
  const { decimal, unitSpace } = style(lang)
  if (value < 1000) return String(value)
  if (value < 1_000_000) {
    // Past 100k the decimal is noise: "200k", not "200.0k"
    const text = (value / 1000).toFixed(value < 100_000 ? 1 : 0)
    return text.replace('.', decimal) + unitSpace + 'k'
  }
  const text = (value / 1_000_000).toFixed(2)
  return text.replace('.', decimal) + unitSpace + 'M'
}

// Share of `input` that was not sent: 48200, 9100 -> "−81%" (en), "−81 %" (fr)
export function percent(input, output, lang = 'en') {
  const unit = style(lang).percentSpace + '%'
  if (!(input > 0)) return '0' + unit
  const saved = Math.round(((input - output) / input) * 100)
  return (saved > 0 ? MINUS : '') + saved + unit
}

// "RUSTFLAGS=-D cargo test --all 2>&1 | tail" -> "cargo test"
export function shortCommand(command) {
  if (typeof command !== 'string') return ''
  const first = command.split(/&&|\|\||[|;\n]/)[0].trim()
  const words = first.split(/\s+/).filter(Boolean)
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
  if (words[0] === 'rtk' && words.length > 1) words.shift()
  const name = (words[0] ?? '').split('/').pop()
  const sub = words[1] && /^[a-z][a-z0-9:_-]*$/i.test(words[1]) ? ' ' + words[1] : ''
  const text = name + sub
  return text.length > 18 ? text.slice(0, 17) + '…' : text
}
