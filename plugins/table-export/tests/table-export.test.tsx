import { expect, test } from 'claude-code/testing'

const REPLY = [
  'Two tables and a fenced one.',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```',
  '| fenced | x |',
  '|---|---|',
  '| no | no |',
  '```',
  '',
  '| name | note | extra |',
  '| :--- | ---: | --- |',
  '| **김** | says "hi", then <br> leaves | a \\| b |',
  '| `lee` | short |',
].join('\n')

const FENCED_ONLY = ['```', '| fenced | x |', '|---|---|', '| no | no |', '```'].join('\n')

const row = (props: { text: string; isFirstOfReply: boolean; isSummary?: true }) =>
  ({ plugin: 'table-export', component: 'AssistantMessage', props }) as const

test('each table in a reply gets a main button and a More button', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('env.get', () => ({ value: '/Users/me' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 28, 5, 6, 7) }))
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...row({ text: REPLY, isFirstOfReply: true }), surface })
    // The engine draws the text up to the first table; the buttons follow each table.
    expect(await ui.find({ type: 'Text', text: /Two tables and a fenced one[\s\S]*\| 1 \| 2 \|$/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /^```[\s\S]*\| `lee` \| short \|$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
      'Copy table 1 TSV',
      'More',
      'Copy table 2 TSV',
      'More',
    ])

    await ui.press({ key: 'main-1' })
    // A cell with a quote is quoted, so a spreadsheet keeps the quote marks.
    expect(copies.at(-1)).toBe('name\tnote\textra\n김\t"says ""hi"", then   leaves"\ta | b\nlee\tshort\t')
    expect(toasts.at(-1)).toBe('Copied table 2 as TSV.')

    await ui.press({ key: 'more-1' })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text).slice(2)).toEqual([
      'Copy table 2 TSV',
      'Less',
      'Save CSV',
      'Copy MD',
      'Copy art',
      'Copy HTML',
      'Copy PNG',
    ])
    await ui.press({ key: 'fmt-1-csv' })
    // A format press closes the row again.
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    expect(writes.at(-1)?.path).toMatch(/^\/Users\/me\/Downloads\/claude-table-\d{8}-\d{6}\.csv$/)
    expect(writes.at(-1)?.text).toBe(
      '﻿name,note,extra\r\n김,"says ""hi"", then   leaves",a | b\r\nlee,short,\r\n',
    )
    expect(toasts.at(-1)).toMatch(/^Saved table 2 \(2 rows\): \/Users\/me\/Downloads\//)

    await ui.press({ key: 'more-0' })
    await ui.press({ key: 'fmt-0-md' })
    expect(copies.at(-1)).toBe('| a | b |\n|---|---|\n| 1 | 2 |')
    await ui.press({ key: 'more-0' })
    await ui.press({ key: 'fmt-0-art' })
    expect(copies.at(-1)).toBe('┌───┬───┐\n│ a │ b │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘')
    await ui.unmount()

    for (const props of [
      { text: FENCED_ONLY, isFirstOfReply: true },
      { text: REPLY, isFirstOfReply: true, isSummary: true as const },
    ]) {
      const plain = await $.ui.mount({ ...row(props), surface })
      expect(await plain.findAll({ type: 'Button' })).toHaveLength(0)
      await plain.unmount()
    }
  }
})

test('the CSV folder comes from the saveDir setting', { options: { saveDir: '~/Documents/tables/' } }, async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('env.get', () => ({ value: '/Users/me' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 28, 5, 6, 7) }))
  const writes: string[] = []
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...row({ text: REPLY, isFirstOfReply: true }), surface: 'terminal' })
  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-csv' })
  expect(writes.at(-1)).toMatch(/^\/Users\/me\/Documents\/tables\/claude-table-\d{8}-\d{6}\.csv$/)
  await ui.unmount()
})

test('a relative saveDir is refused with a toast', { options: { saveDir: 'tables' } }, async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const writes: string[] = []
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...row({ text: REPLY, isFirstOfReply: true }), surface: 'terminal' })
  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-csv' })
  expect(writes).toHaveLength(0)
  expect(toasts.at(-1)).toBe('CSV folder must be absolute or start with ~/: tables')
  await ui.unmount()
})

test('the main button follows the defaultFormat setting', { options: { defaultFormat: 'art' } }, async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...row({ text: REPLY, isFirstOfReply: true }), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text).slice(0, 2)).toEqual(['Copy table 1 art', 'More'])
  await ui.press({ key: 'main-1' })
  // Korean takes two columns, so its row lines up with the others; `---:` right-aligns the second column.
  expect(copies.at(-1)?.split('\n').slice(3, 5)).toEqual([
    '│ 김   │ says "hi", then   leaves │ a | b │',
    '│ lee  │                    short │       │',
  ])
  await ui.press({ key: 'more-1' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text).slice(4)).toEqual([
    'Copy TSV',
    'Save CSV',
    'Copy MD',
    'Copy HTML',
    'Copy PNG',
  ])
  await ui.unmount()
})

test('HTML and PNG go through osascript, with a fallback when it fails', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const runs: (readonly string[])[] = []
  let works = true
  on('process.run', (_, e) => {
    runs.push(e.argv)
    if (!works) throw new Error('spawn osascript ENOENT')
    return { value: { exitCode: 0, stdout: 'copied\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...row({ text: REPLY, isFirstOfReply: true }), surface: 'terminal' })
  await ui.press({ key: 'more-1' })
  await ui.press({ key: 'fmt-1-html' })
  expect(runs.at(-1)?.slice(0, 4)).toEqual(['osascript', '-l', 'JavaScript', '-e'])
  expect(runs.at(-1)?.[5]).toBe(
    '<table><thead><tr><th style="text-align:left">name</th><th style="text-align:right">note</th><th>extra</th></tr></thead><tbody>' +
      '<tr><td style="text-align:left">김</td><td style="text-align:right">says &quot;hi&quot;, then   leaves</td><td>a | b</td></tr>' +
      '<tr><td style="text-align:left">lee</td><td style="text-align:right">short</td><td></td></tr></tbody></table>',
  )
  expect(toasts.at(-1)).toBe('Copied table 2 as HTML.')

  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-png' })
  expect(runs.at(-1)?.slice(5)).toEqual(['[["a","b"],["1","2"]]', '[null,null]'])
  expect(toasts.at(-1)).toBe('Copied table 1 as PNG.')

  works = false
  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-html' })
  expect(copies.at(-1)).toMatch(/^<table>/)
  expect(toasts.at(-1)).toMatch(/^Copied table 1 as HTML source \(osascript did not run \(macOS only\)/)
  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-png' })
  expect(toasts.at(-1)).toMatch(/^Not copied: osascript did not run \(macOS only\)/)
  await ui.unmount()
})

test('tables without outer pipes, longer fences and inline markdown', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  const text = [
    'name | link',
    ':---: | ---',
    '*kim* | [docs](https://example.com)',
    '~~old~~ | snake_case_name',
    '',
    '````',
    '```',
    'a | b',
    '--- | ---',
    '```',
    '````',
    '',
    'a rule, not a table',
    '---',
    '',
    '| x | y |',
    '| --- |',
    '| 1 | 2 |',
  ].join('\n')
  const ui = await $.ui.mount({ ...row({ text, isFirstOfReply: true }), surface: 'terminal' })
  // Only the first table counts: the second is inside a four-backtick fence, the third's separator is short a cell.
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Copy table 1 TSV', 'More'])
  await ui.press({ key: 'main-0' })
  expect(copies.at(-1)).toBe('name\tlink\nkim\tdocs\nold\tsnake_case_name')
  await ui.press({ key: 'more-0' })
  await ui.press({ key: 'fmt-0-art' })
  expect(copies.at(-1)?.split('\n')[3]).toBe('│ kim  │ docs            │')
  await ui.unmount()
})
