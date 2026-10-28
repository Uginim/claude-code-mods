import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change } from '../types'

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

const PANE = 'edit-diff-log'
const TITLE = 'Edit diffs'
// Keeps the last 100 edits and up to 20k chars of hunks each; raise these if the pane needs more.
const KEEP = 100
const PATCH_CHARS = 20_000

const changes = atom({ plugin: 'edit-diff-log', key: 'changes' } as const, [], {
  shape: 'changes-1',
})
const openId = atom({ plugin: 'edit-diff-log', key: 'openId' } as const, null)

const fileName = (path: string) => path.split('/').pop() || path
const hhmmss = (at: number) => {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

// Whole hunks only: a hunk cut in the middle no longer draws as a diff.
const toPatch = (hunks: readonly Hunk[]) => {
  let patch = ''
  for (const h of hunks) {
    const text = [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')
    if (patch.length + text.length > PATCH_CHARS) break
    patch = patch ? `${patch}\n${text}` : text
  }

  return patch
}

const STORE_KEY = 'changes'

const mergeById = (...lists: readonly (readonly Change[])[]) =>
  [...new Map(lists.flat().map(item => [item.id, item])).values()]
    .sort((a, b) => a.at - b.at)
    .slice(-KEEP)

const stored = async ($: EngineInterface) => {
  const value = await $.store.get(STORE_KEY)

  return Array.isArray(value) ? (value as Change[]) : []
}

// One list shared by every session: read the store, merge, write it back.
// No lock: two sessions writing at the same instant can drop one entry.
// 100 edits of 20k chars each stay under the store's 4 MiB limit.
const persist = async ($: EngineInterface, added: readonly Change[] = []) => {
  const fromStore = await stored($)
  const merged = await update($, changes, list => mergeById(fromStore, list, added))
  await $.store.set(STORE_KEY, merged)
}

const record = async ($: EngineInterface, path: string, hunks: readonly Hunk[]) => {
  if (hunks.length === 0) return
  const at = await $.clock.now()
  const lines = hunks.flatMap(h => h.lines)
  const change: Change = {
    id: `${at}-${path}`,
    path,
    name: fileName(path),
    at,
    added: lines.filter(l => l.startsWith('+')).length,
    removed: lines.filter(l => l.startsWith('-')).length,
    patch: toPatch(hunks),
    session: await $.session.id(),
  }
  await persist($, [change])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'edit-diffs',
      description: 'Open or close the pane of file edits Claude made',
    })
    await persist($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'edit-diffs' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: 'Edit diffs pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })

    return { text: 'Edit diffs pane opened.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.staged !== true) {
      await record($, e.file_path, ran.result.structuredPatch)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (
      ran.deny === undefined &&
      ran.isError !== true &&
      ran.result.type === 'update' &&
      ran.result.staged !== true
    ) {
      await record($, e.file_path, ran.result.structuredPatch)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, changes)
    const open = await read($, openId)
    const current = await $.session.id()

    return (
      <Box flexDirection="column">
        <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
          Close
        </Button>
        {list.length === 0 && <Text dimColor>No edits yet.</Text>}
        {[...list].reverse().map(item => (
          <Box key={`row-${item.id}`} flexDirection="column">
            <Button
              key={item.id}
              plain
              onPress={() => update($, openId, cur => (cur === item.id ? null : item.id))}
            >
              <Text dimColor>{hhmmss(item.at)}</Text> {item.name}{' '}
              <Text color="green">+{item.added}</Text> <Text color="red">-{item.removed}</Text>
              {item.session !== undefined && item.session !== current && (
                <Text dimColor> [{item.session.slice(0, 4)}]</Text>
              )}
            </Button>
            {open === item.id && (
              <Box flexDirection="column" paddingLeft={2}>
                <Text dimColor>{item.path}</Text>
                {item.patch ? (
                  <Code format="diff" source={item.patch} path={item.path} />
                ) : (
                  <Text dimColor>Diff too large to show.</Text>
                )}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
