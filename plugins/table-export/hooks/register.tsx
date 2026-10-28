import type { EngineInterface, Register } from 'claude-code'

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

// Every table in a reply block, in order, outside fenced code blocks.
const tablesIn = (text: string) => {
  const tables: string[][][] = []
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
    tables.push(rows)
    i = j - 1
  }

  return tables
}

const csvCell = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
// The BOM lets Excel read the file as UTF-8, so Korean text is not garbled.
const toCsv = (rows: string[][]) => `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
// Tabs paste into separate spreadsheet cells; CSV would land in one column.
const toTsv = (rows: string[][]) => rows.map(row => row.map(cell => cell.replace(/\t/g, ' ')).join('\t')).join('\n')

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

export const register: Register = (on, options) => {
  const saveDir = typeof options.saveDir === 'string' ? options.saveDir : DEFAULT_DIR

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const tables = e.props.isSummary ? [] : tablesIn(e.props.text)
    if (tables.length === 0) return drawn
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        {tables.map((rows, i) => (
          <Box key={`table-${i}`} flexDirection="row" gap={1}>
            <Button
              key={`copy-${i}`}
              onPress={async press => {
                const copied = await $.ui.copy({ text: toTsv(rows), surface: press.surface })
                $.ui.toast(copied.isCopied ? `Copied table ${i + 1} as TSV.` : `Not copied: ${copied.reason}`)
              }}
            >
              {`Copy table ${i + 1}`}
            </Button>
            <Button key={`save-${i}`} onPress={() => save($, rows, i + 1, saveDir)}>
              {`Save table ${i + 1} CSV`}
            </Button>
          </Box>
        ))}
      </Box>
    )
  })
}
