import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Format } from '../types'

// Only tables whose rows start and end with `|` count; add GFM's pipe-less form when needed.
const ROW = /^\s*\|.*\|\s*$/
const SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/
const FENCE = /^\s*(```|~~~)/

const splitRow = (line: string) =>
  line
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map(cell =>
      cell
        .trim()
        .replace(/\\\|/g, '|')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/\*\*|__|`/g, ''),
    )

// Every table in a reply block, in order, outside fenced code blocks, with its first line and the line after its last row.
const tablesIn = (text: string) => {
  const tables: { rows: string[][]; start: number; end: number }[] = []
  const lines = text.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || !ROW.test(line) || !SEPARATOR.test(lines[i + 1] ?? '')) continue
    const header = splitRow(line)
    const rows = [header]
    let j = i + 2
    for (; ROW.test(lines[j] ?? ''); j++) {
      const cells = splitRow(lines[j] ?? '')
      rows.push(header.map((_, c) => cells[c] ?? ''))
    }
    tables.push({ rows, start: i, end: j })
    i = j - 1
  }

  return tables
}

const csvCell = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
// The BOM lets Excel read the file as UTF-8, so Korean text is not garbled.
const toCsv = (rows: string[][]) => `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
// Tabs paste into separate spreadsheet cells; CSV would land in one column.
const toTsv = (rows: string[][]) => rows.map(row => row.map(cell => cell.replace(/\t/g, ' ')).join('\t')).join('\n')

// East Asian wide characters and emoji take two terminal columns.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
]
const widthOf = (text: string) =>
  [...text].reduce((sum, ch) => {
    const code = ch.codePointAt(0) ?? 0
    return sum + (WIDE.some(([lo, hi]) => code >= (lo ?? 0) && code <= (hi ?? 0)) ? 2 : 1)
  }, 0)

const toArt = (rows: string[][]) => {
  const widths = (rows[0] ?? []).map((_, c) => Math.max(...rows.map(row => widthOf(row[c] ?? ''))))
  const rule = (l: string, m: string, r: string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r
  const line = (row: string[]) =>
    `│${widths.map((w, c) => ` ${row[c] ?? ''}${' '.repeat(w - widthOf(row[c] ?? ''))} `).join('│')}│`
  const [header = [], ...body] = rows

  return [rule('┌', '┬', '┐'), line(header), rule('├', '┼', '┤'), ...body.map(line), rule('└', '┴', '┘')].join('\n')
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const toHtml = (rows: string[][]) => {
  const [header = [], ...body] = rows
  const cells = (row: string[], tag: string) => row.map(cell => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')

  return `<table><thead><tr>${cells(header, 'th')}</tr></thead><tbody>${body.map(row => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>`
}

// JXA scripts for what $.ui.copy cannot put on the clipboard. Each prints `copied` on success.
const HTML_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const board = $.NSPasteboard.generalPasteboard
  board.clearContents
  const html = board.setStringForType($(argv[0]), $.NSPasteboardTypeHTML)
  const text = board.setStringForType($(argv[1]), $.NSPasteboardTypeString)
  return html && text ? 'copied' : 'refused'
}`

// Draws the table at twice its point size: white cells, a grey bold header, grey grid lines.
const PNG_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const rows = JSON.parse(argv[0])
  const pad = 8, line = 1, scale = 2
  const color = (r, g, b) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1)
  const attrs = bold => {
    const d = $.NSMutableDictionary.alloc.init
    d.setObjectForKey(bold ? $.NSFont.boldSystemFontOfSize(14) : $.NSFont.systemFontOfSize(14), $.NSFontAttributeName)
    d.setObjectForKey(color(0.1, 0.1, 0.1), $.NSForegroundColorAttributeName)
    return d
  }
  const cells = rows.map((row, r) => row.map(text => {
    const a = attrs(r === 0), str = $(text)
    return { str, a, size: str.sizeWithAttributes(a) }
  }))
  const widths = rows[0].map((_, c) => Math.ceil(Math.max(...cells.map(row => row[c].size.width))) + pad * 2)
  const heights = cells.map(row => Math.ceil(Math.max(...row.map(cell => cell.size.height))) + pad)
  const W = widths.reduce((a, b) => a + b, 0) + line, H = heights.reduce((a, b) => a + b, 0) + line
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, W * scale, H * scale, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
  rep.setSize($.NSMakeSize(W, H))
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  color(1, 1, 1).setFill; $.NSRectFill($.NSMakeRect(0, 0, W, H))
  color(0.94, 0.94, 0.95).setFill; $.NSRectFill($.NSMakeRect(0, H - heights[0] - line, W, heights[0] + line))
  let top = 0
  cells.forEach((row, r) => {
    let left = 0
    row.forEach((cell, c) => {
      cell.str.drawAtPointWithAttributes($.NSMakePoint(left + line + pad, H - top - line - pad / 2 - cell.size.height), cell.a)
      left += widths[c]
    })
    top += heights[r]
  })
  color(0.75, 0.75, 0.78).setFill
  let x = 0; [0, ...widths].forEach(w => { x += w; $.NSRectFill($.NSMakeRect(x, 0, line, H)) })
  let y = 0; [0, ...heights].forEach(h => { y += h; $.NSRectFill($.NSMakeRect(0, H - y - line, W, line)) })
  $.NSGraphicsContext.restoreGraphicsState
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
  const board = $.NSPasteboard.generalPasteboard
  board.clearContents
  return board.setDataForType(png, $.NSPasteboardTypePNG) ? 'copied' : 'refused'
}`

// Runs a JXA script with osascript, which only macOS has; resolves to the reason it failed, if it did.
const jxa = async ($: EngineInterface, script: string, args: string[]) => {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['osascript', '-l', 'JavaScript', '-e', script, ...args])
    if (exitCode === 0 && stdout.trim() === 'copied') return undefined
    return stderr.trim() || stdout.trim() || `osascript exited with ${exitCode}`
  } catch (error) {
    return `osascript did not run (macOS only): ${error instanceof Error ? error.message : String(error)}`
  }
}

const stamp = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const DEFAULT_DIR = '~/Downloads'

// Resolves the configured folder to an absolute path, or a reason it cannot be used.
const resolveDir = async ($: EngineInterface, configured: string) => {
  const dir = configured.trim().replace(/\/+$/, '') || DEFAULT_DIR
  if (dir.startsWith('/')) return { dir }
  if (dir !== '~' && !dir.startsWith('~/')) return { reason: `CSV folder must be absolute or start with ~/: ${dir}` }
  const home = await $.env.get('HOME')
  if (home === undefined) return { reason: `HOME is not set, so ${dir} cannot be found.` }

  return { dir: home + dir.slice(1) }
}

const save = async ($: EngineInterface, rows: string[][], n: number, saveDir: string) => {
  const resolved = await resolveDir($, saveDir)
  if (resolved.dir === undefined) return $.ui.toast(resolved.reason)
  const path = `${resolved.dir}/claude-table-${stamp(await $.clock.now())}.csv`
  try {
    await $.fs.write(path, toCsv(rows))
  } catch (error) {
    return $.ui.toast(`Not saved to ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  $.ui.toast(`Saved table ${n} (${rows.length - 1} rows): ${path}`)
}

type Table = { rows: string[][]; markdown: string }

// The label on the main button (with the table's number) and on the extra row.
const LABELS: Record<Format, { main: (n: number) => string; extra: string }> = {
  tsv: { main: n => `Copy table ${n} TSV`, extra: 'Copy TSV' },
  csv: { main: n => `Save table ${n} CSV`, extra: 'Save CSV' },
  md: { main: n => `Copy table ${n} Markdown`, extra: 'Copy MD' },
  art: { main: n => `Copy table ${n} art`, extra: 'Copy art' },
  html: { main: n => `Copy table ${n} HTML`, extra: 'Copy HTML' },
  png: { main: n => `Copy table ${n} PNG`, extra: 'Copy PNG' },
}

const copyAs = async ($: EngineInterface, name: string, text: string, n: number, surface: RenderSurface) => {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? `Copied table ${n} as ${name}.` : `Not copied: ${copied.reason}`)
}

const exportAs = async ($: EngineInterface, format: Format, t: Table, n: number, surface: RenderSurface, saveDir: string) => {
  switch (format) {
    case 'tsv':
      return copyAs($, 'TSV', toTsv(t.rows), n, surface)
    case 'csv':
      return save($, t.rows, n, saveDir)
    case 'md':
      return copyAs($, 'Markdown', t.markdown, n, surface)
    case 'art':
      return copyAs($, 'box-drawing text', toArt(t.rows), n, surface)
    case 'html': {
      const reason = await jxa($, HTML_SCRIPT, [toHtml(t.rows), toTsv(t.rows)])
      if (reason === undefined) return $.ui.toast(`Copied table ${n} as HTML.`)
      // Without the macOS clipboard, the HTML source is still useful as text.
      const copied = await $.ui.copy({ text: toHtml(t.rows), surface })
      return $.ui.toast(copied.isCopied ? `Copied table ${n} as HTML source (${reason})` : `Not copied: ${reason}`)
    }
    case 'png': {
      const reason = await jxa($, PNG_SCRIPT, [JSON.stringify(t.rows)])
      return $.ui.toast(reason === undefined ? `Copied table ${n} as PNG.` : `Not copied: ${reason}`)
    }
  }
}

const FORMAT_NAMES = ['tsv', 'csv', 'md', 'art', 'html', 'png'] as const
const isFormat = (value: unknown): value is Format => FORMAT_NAMES.some(f => f === value)

// The table whose extra format buttons are showing, keyed by its markdown and position.
const openId = atom({ plugin: 'table-export', key: 'openId' } as const, null)

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export const register: Register = (on, options) => {
  const saveDir = typeof options.saveDir === 'string' ? options.saveDir : DEFAULT_DIR
  const main = isFormat(options.defaultFormat) ? options.defaultFormat : 'tsv'
  const extras = FORMAT_NAMES.filter(f => f !== main)

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const tables = e.props.isSummary ? [] : tablesIn(e.props.text)
    if (tables.length === 0) return next(e)
    const { Box, Button, Markdown } = $.ui.resolve(e)
    const lines = e.props.text.split('\n')
    // The block is cut after each table so its buttons sit right under it; the engine draws the
    // first piece (keeping the reply's bullet), Markdown draws the rest. next runs only once.
    const pieces = tables.map((t, i) => lines.slice(i === 0 ? 0 : (tables[i - 1]?.end ?? 0), t.end).join('\n'))
    const tail = lines.slice(tables.at(-1)?.end).join('\n')
    const first = await next({ ...e, props: { ...e.props, text: pieces[0] ?? '' } })
    const open = await read($, openId)
    const rest = (text: string, key: string) =>
      text.trim() === '' ? null : (
        <Box key={key} paddingLeft={2}>
          <Markdown key={`${key}-md`} text={text.replace(/^\n+/, '')} />
        </Box>
      )

    return (
      <Box flexDirection="column">
        {tables.map(({ rows, start, end }, i) => {
          const t = { rows, markdown: lines.slice(start, end).join('\n') }
          const id = `${hash(t.markdown)}-${i}`
          const isOpen = open === id
          return (
            <Box key={`piece-${i}`} flexDirection="column">
              {i === 0 ? first : rest(pieces[i] ?? '', `text-${i}`)}
              <Box key={`table-${i}`} flexDirection="row" gap={1}>
                <Button key={`main-${i}`} onPress={press => exportAs($, main, t, i + 1, press.surface, saveDir)}>
                  {LABELS[main].main(i + 1)}
                </Button>
                <Button key={`more-${i}`} onPress={() => update($, openId, cur => (cur === id ? null : id))}>
                  {isOpen ? 'Less' : 'More'}
                </Button>
                {isOpen
                  ? extras.map(f => (
                      <Button
                        key={`fmt-${i}-${f}`}
                        onPress={async press => {
                          await update($, openId, () => null)
                          await exportAs($, f, t, i + 1, press.surface, saveDir)
                        }}
                      >
                        {LABELS[f].extra}
                      </Button>
                    ))
                  : null}
              </Box>
            </Box>
          )
        })}
        {rest(tail, 'text-tail')}
      </Box>
    )
  })
}
