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
  on('session.cwd', () => ({ value: '/work/demo' }))
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

  const kept = saved as { name: string; dir?: string }[]
  expect(kept.map(item => item.name)).toEqual(['prev.md', 'new.md', 'gist.github.com/…/abc123'])
  expect(kept.map(item => item.dir)).toEqual([undefined, 'demo', 'demo'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const file = await ui.find({ type: 'Button', text: /new\.md/ })
    expect(file?.text).toMatch(/^\d\d:\d\d:\d\d file new\.md$/)
    expect(await ui.find({ type: 'Button', text: /old\.md/ })).toBeUndefined()
    expect((await ui.find({ type: 'Button', text: /gist/ }))?.text).toMatch(
      /link gist\.github\.com\/…\/abc123$/,
    )
    expect(await ui.find({ type: 'Button', text: /example/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'This session · 1 file, 1 link' })).toBeDefined()

    // Another session's entries sit under a folded header until it is pressed.
    expect(await ui.find({ type: 'Button', text: /prev\.md/ })).toBeUndefined()
    const other = await ui.find({ type: 'Button', text: /\[othe\]/ })
    expect(other?.text).toMatch(/^▸ \d\d-\d\d \d\d:\d\d · 1 file \[othe\]$/)
    await ui.press({ key: other!.key! })
    expect((await ui.find({ type: 'Button', text: /prev\.md/ }))?.text).toMatch(/^\d\d:\d\d:\d\d file prev\.md$/)
    await ui.press({ key: other!.key! })
    expect(await ui.find({ type: 'Button', text: /prev\.md/ })).toBeUndefined()

    expect(await ui.find({ type: 'Text', text: '/work/docs/new.md' })).toBeUndefined()
    await ui.press({ key: file!.key! })
    expect(await ui.find({ type: 'Text', text: /\/work\/docs\/new\.md/ })).toBeDefined()
    await ui.press({ key: file!.key! })
    expect(await ui.find({ type: 'Text', text: /\/work\/docs\/new\.md/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('an opened row offers Open, Show in folder and Copy path; scripts are only shown', async ($, on) => {
  on('command.register', () => ({ value: { command: 'creations' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 26, 3, 4, 5) }))
  on('session.id', () => ({ value: 'this-session' }))
  on('session.cwd', () => ({ value: '/work/demo' }))
  on('store.get', () => ({
    value: [
      { id: 'a', kind: 'file', name: 'notes.md', full: '/w/notes.md', at: 1, session: 'this-session' },
      { id: 'b', kind: 'file', name: 'run.sh', full: '/w/run.sh', at: 2, session: 'this-session' },
      { id: 'c', kind: 'link', name: 'gist', full: 'https://gist.github.com/x/1', at: 3, session: 'this-session' },
    ],
  }))
  on('store.set', () => ({ value: undefined }))
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    // No `open` here, as on Linux: the mod falls back to xdg-open.
    if (e.argv[0] === 'open') throw new Error('spawn open ENOENT')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'a' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text).slice(6)).toEqual(['Open', 'Show in folder', 'Copy path'])
  await ui.press({ key: 'open-a' })
  expect(runs.slice(-2)).toEqual([['open', '/w/notes.md'], ['xdg-open', '/w/notes.md']])
  await ui.press({ key: 'reveal-a' })
  expect(runs.slice(-2)).toEqual([['open', '-R', '/w/notes.md'], ['xdg-open', '/w']])
  await ui.press({ key: 'copy-a' })
  expect(copies.at(-1)).toBe('/w/notes.md')
  expect(toasts.at(-1)).toBe('Copied path.')

  await ui.press({ key: 'b' })
  expect(await ui.find({ key: 'open-b' })).toBeUndefined()
  expect(await ui.find({ key: 'reveal-b' })).toBeDefined()

  await ui.press({ key: 'c' })
  expect(await ui.find({ key: 'reveal-c' })).toBeUndefined()
  await ui.press({ key: 'copy-c' })
  expect(copies.at(-1)).toBe('https://gist.github.com/x/1')
  expect(toasts.at(-1)).toBe('Copied URL.')
  await ui.unmount()
})

test('This session hides earlier sessions, and the choice is remembered', async ($, on) => {
  on('command.register', () => ({ value: { command: 'creations' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'this-session' }))
  const store: Record<string, unknown> = {
    entries: [
      { id: 'a', kind: 'file', name: 'mine.md', full: '/w/mine.md', at: 2, session: 'this-session' },
      { id: 'b', kind: 'file', name: 'prev.md', full: '/w/prev.md', at: 1, session: 'other-session' },
    ],
  }
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /\[othe\]/ })).toBeDefined()

  await ui.press({ key: 'scope-session' })
  expect(await ui.find({ type: 'Button', text: /\[othe\]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '1 earlier session hidden.' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /mine\.md/ })).toBeDefined()
  expect(store.scope).toBe('session')

  await ui.press({ key: 'scope-all' })
  expect(await ui.find({ type: 'Button', text: /\[othe\]/ })).toBeDefined()
  expect(store.scope).toBe('all')
  await ui.unmount()
})
