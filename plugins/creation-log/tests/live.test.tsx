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

test('a file created while the pane is open shows up, Close closes the pane', async ($, on) => {
  on('command.register', () => ({ value: { command: 'creations' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let now = Date.UTC(2026, 9, 26, 3, 4, 5)
  on('clock.now', () => ({ value: now++ }))
  on('session.id', () => ({ value: 'this-session' }))
  on('session.cwd', () => ({ value: '/w' }))
  let saved: unknown = []
  on('store.get', () => ({ value: saved }))
  on('store.set', (_, e) => {
    saved = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Write' }, (_, e) => ({
    result: { type: 'create', filePath: e.file_path, content: '', structuredPatch: [], originalFile: null },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'Write', file_path: '/w/one.md', content: '' })
  expect(await ui.find({ type: 'Button', text: /one\.md/ })).toBeDefined()
  const one = await ui.find({ type: 'Button', text: /one\.md/ })
  await ui.press({ key: one!.key! })
  await $.tool.call({ tool: 'Write', file_path: '/w/two.md', content: '' })
  expect(await ui.find({ type: 'Button', text: /two\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/w\/one\.md/ })).toBeDefined()
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['creation-log'])
  await ui.unmount()
})
