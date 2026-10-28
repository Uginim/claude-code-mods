import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'creation-log',
  component: 'Pane',
  requestId: 'creation-log',
  props: {
    title: 'Creations',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('new files and gh links are listed, a press shows the full path', async ($, on) => {
  on('command.register', () => ({ value: { command: 'creations' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 26, 3, 4, 5) }))
  on('session.id', () => ({ value: 'this-session' }))
  let saved: unknown = [
    { id: 'prev', kind: 'file', name: 'prev.md', full: '/prev/prev.md', at: 1, session: 'other-session' },
  ]
  on('store.get', () => ({ value: saved }))
  on('store.set', (_, e) => {
    saved = e.value

    return { value: undefined }
  })
  on('tool.call', { tool: 'Write' }, (_, e) => ({
    result: {
      type: e.file_path.endsWith('old.md') ? 'update' : 'create',
      filePath: e.file_path,
      content: '',
      structuredPatch: [],
      originalFile: null,
    },
  }))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: 'https://gist.github.com/someone/abc123\n',
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/work/docs/new.md', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/work/docs/old.md', content: '' })
  await $.tool.call({ tool: 'Bash', command: 'gh gist create note.md' })
  await $.tool.call({ tool: 'Bash', command: 'curl https://example.com' })

  const kept = saved as { name: string }[]
  expect(kept.map(item => item.name)).toEqual(['prev.md', 'new.md', 'gist.github.com/…/abc123'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const file = await ui.find({ type: 'Button', text: /new\.md/ })
    expect(file?.text).toMatch(/^\d\d:\d\d:\d\d file new\.md$/)
    expect(await ui.find({ type: 'Button', text: /old\.md/ })).toBeUndefined()
    expect((await ui.find({ type: 'Button', text: /gist/ }))?.text).toMatch(
      /link gist\.github\.com\/…\/abc123$/,
    )
    expect(await ui.find({ type: 'Button', text: /example/ })).toBeUndefined()
    expect((await ui.find({ type: 'Button', text: /prev\.md/ }))?.text).toMatch(/file prev\.md \[othe\]$/)

    expect(await ui.find({ type: 'Text', text: '/work/docs/new.md' })).toBeUndefined()
    await ui.press({ key: file!.key! })
    expect(await ui.find({ type: 'Text', text: /\/work\/docs\/new\.md/ })).toBeDefined()
    await ui.press({ key: file!.key! })
    expect(await ui.find({ type: 'Text', text: /\/work\/docs\/new\.md/ })).toBeUndefined()
    await ui.unmount()
  }
})
