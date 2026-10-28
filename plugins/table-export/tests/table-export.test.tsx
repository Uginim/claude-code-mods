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

test('each table in a reply gets a copy and a save button', async ($, on) => {
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
    expect(await ui.find({ type: 'Text', text: /Two tables and a fenced one/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
      'Copy table 1',
      'Save table 1 CSV',
      'Copy table 2',
      'Save table 2 CSV',
    ])

    await ui.press({ key: 'copy-1' })
    expect(copies.at(-1)).toBe('name\tnote\textra\n김\tsays "hi", then   leaves\ta | b\nlee\tshort\t')
    expect(toasts.at(-1)).toBe('Copied table 2 as TSV.')

    await ui.press({ key: 'save-1' })
    expect(writes.at(-1)?.path).toMatch(/^\/Users\/me\/Downloads\/claude-table-\d{8}-\d{6}\.csv$/)
    expect(writes.at(-1)?.text).toBe(
      '﻿name,note,extra\r\n김,"says ""hi"", then   leaves",a | b\r\nlee,short,\r\n',
    )
    expect(toasts.at(-1)).toMatch(/^Saved table 2 \(2 rows\): \/Users\/me\/Downloads\//)

    await ui.press({ key: 'copy-0' })
    expect(copies.at(-1)).toBe('a\tb\n1\t2')
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
