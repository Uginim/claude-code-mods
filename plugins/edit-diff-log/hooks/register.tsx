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
const shownSession = atom({ plugin: 'edit-diff-log', key: 'shownSession' } as const, null)

const fileName = (path: string) => path.split('/').pop() || path
const hhmmss = (at: number) => {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

const mmddhhmm = (at: number) => {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

// Newest first: this session's group, then the others by their latest entry. Entries saved
// without a session id form one group with the id ''.
const groupBySession = <T extends { at: number; session?: string }>(list: readonly T[], current: string) => {
  const groups = new Map<string, T[]>()
  for (const item of [...list].reverse()) {
    const id = item.session ?? ''
    groups.set(id, [...(groups.get(id) ?? []), item])
  }

  return [...groups]
    .map(([id, items]) => ({ id, items, isCurrent: id === current }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
}

// `MM-DD HH:MM · folder · summary [id]`, the time being the group's oldest kept entry.
const sessionLabel = (id: string, items: readonly { at: number; dir?: string }[], summary: string) => {
  if (id === '') return `Unknown session · ${summary}`
  const dir = items.find(item => item.dir !== undefined)?.dir
  const start = mmddhhmm(items.at(-1)?.at ?? 0)

  return [start, dir, summary].filter(Boolean).join(' · ') + ` [${id.slice(0, 4)}]`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const summarize = (items: readonly Change[]) =>
  `${plural(items.length, 'edit')} +${items.reduce((n, item) => n + item.added, 0)} -${items.reduce((n, item) => n + item.removed, 0)}`

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
    dir: await $.session.cwd().then(fileName, () => undefined),
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
    const shown = await read($, shownSession)
    const groups = groupBySession(list, await $.session.id())

    const copyPath = async (path: string) => {
      const copied = await $.ui.copy({ text: path, surface: e.surface })
      await $.ui.toast(copied.isCopied ? 'Copied path.' : `Not copied: ${copied.reason ?? 'no clipboard'}`)
    }

    const rows = (items: readonly Change[]) =>
      items.map(item => (
        <Box key={`row-${item.id}`} flexDirection="column">
          <Button key={item.id} plain onPress={() => update($, openId, cur => (cur === item.id ? null : item.id))}>
            <Text dimColor>{hhmmss(item.at)}</Text> {item.name} <Text color="green">+{item.added}</Text>{' '}
            <Text color="red">-{item.removed}</Text>
          </Button>
          {open === item.id && (
            <Box flexDirection="column" paddingLeft={2}>
              <Box flexDirection="row" gap={1}>
                <Text dimColor>{item.path}</Text>
                <Button key={`copy-${item.id}`} onPress={() => copyPath(item.path)}>
                  Copy path
                </Button>
              </Box>
              {item.patch ? (
                <Code format="diff" source={item.patch} path={item.path} />
              ) : (
                <Text dimColor>Diff too large to show.</Text>
              )}
            </Box>
          )}
        </Box>
      ))

    return (
      <Box flexDirection="column">
        <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
          Close
        </Button>
        {list.length === 0 && <Text dimColor>No edits yet.</Text>}
        {list.length > 0 && groups[0]?.isCurrent !== true && <Text dimColor>No edits in this session yet.</Text>}
        {groups.map(({ id, items, isCurrent }) =>
          isCurrent ? (
            <Box key={`s-${id}`} flexDirection="column">
              <Text bold>This session · {summarize(items)}</Text>
              {rows(items)}
            </Box>
          ) : (
            <Box key={`s-${id || 'unknown'}`} flexDirection="column">
              <Button
                key={`session-${id || 'unknown'}`}
                plain
                onPress={() => update($, shownSession, cur => (cur === id ? null : id))}
              >
                <Text dimColor>
                  {shown === id ? '▾' : '▸'} {sessionLabel(id, items, summarize(items))}
                </Text>
              </Button>
              {shown === id && rows(items)}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
