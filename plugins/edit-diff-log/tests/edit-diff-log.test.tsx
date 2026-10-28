import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'edit-diff-log',
  component: 'Pane',
  requestId: 'edit-diff-log',
  props: {
    title: 'Edit diffs',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const HUNK = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ['-a', '+b', '+c'] }

test('edits and overwrites are listed with counts, a press shows the diff', async ($, on) => {
  on('command.register', () => ({ value: { command: 'edit-diffs' } }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 26, 3, 4, 5) }))
  on('session.id', () => ({ value: 'this-session' }))
  on('session.cwd', () => ({ value: '/work/demo' }))
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  let saved: unknown = [
    { id: 'prev', path: '/prev/b.ts', name: 'b.ts', at: 1, added: 1, removed: 0, patch: '@@ -1,0 +1,1 @@\n+x', session: 'other-session' },
  ]
  on('store.get', () => ({ value: saved }))
  on('store.set', (_, e) => {
    saved = e.value

    return { value: undefined }
  })
  on('tool.call', { tool: 'Edit' }, (_, e) => ({
    result: {
      filePath: e.file_path,
      oldString: e.old_string,
      newString: e.new_string,
      originalFile: null,
      structuredPatch: [HUNK],
      userModified: false,
      replaceAll: false,
    },
  }))
  on('tool.call', { tool: 'Write' }, (_, e) => ({
    result: {
      type: e.file_path.endsWith('new.md') ? 'create' : 'update',
      filePath: e.file_path,
      content: '',
      structuredPatch: [HUNK],
      originalFile: null,
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'Write', file_path: '/work/old.md', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/work/new.md', content: '' })

  const kept = saved as { name: string }[]
  expect(kept.map(item => item.name)).toEqual(['b.ts', 'a.ts', 'old.md'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const edit = await ui.find({ type: 'Button', text: /a\.ts/ })
    expect(edit?.text).toMatch(/^\d\d:\d\d:\d\d a\.ts \+2 -1$/)
    expect(await ui.find({ type: 'Button', text: /old\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /new\.md/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'This session · 2 edits +4 -2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /b\.ts/ })).toBeUndefined()
    const other = await ui.find({ type: 'Button', text: /\[othe\]/ })
    expect(other?.text).toMatch(/^▸ \d\d-\d\d \d\d:\d\d · 1 edit \+1 -0 \[othe\]$/)
    await ui.press({ key: other!.key! })
    expect((await ui.find({ type: 'Button', text: /b\.ts/ }))?.text).toMatch(/^\d\d:\d\d:\d\d b\.ts \+1 -0$/)
    await ui.press({ key: other!.key! })

    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: edit!.key! })
    expect(await ui.find({ type: 'Text', text: '/work/a.ts' })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -3,1 +3,2 @@\n-a\n+b\n+c')
    await ui.press({ key: `copy-${edit!.key!}` })
    expect(copies.at(-1)).toBe('/work/a.ts')
    await ui.press({ key: edit!.key! })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: 'close' })
    expect(closed.at(-1)).toBe('edit-diff-log')
    await ui.unmount()
  }
})
