import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'creation-log'
const TITLE = 'Creations'
const URLS = /https?:\/\/[^\s"'`<>)\]]+/g
// Only `gh ... create` commands count as links; add other CLIs here when needed.
const GH_CREATE = /\bgh\s+(gist|pr|issue|release|repo)\s+create\b/

const entries = atom({ plugin: 'creation-log', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
const openId = atom({ plugin: 'creation-log', key: 'openId' } as const, null)

const fileName = (path: string) => path.split('/').pop() || path
const linkName = (url: string) => {
  const { hostname, pathname } = new URL(url)
  const last = pathname.split('/').filter(Boolean).pop()

  return last ? `${hostname}/…/${last}` : hostname
}
const hhmmss = (at: number) => {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

const STORE_KEY = 'entries'
const KEEP = 500

const mergeById = (...lists: readonly (readonly Entry[])[]) =>
  [...new Map(lists.flat().map(item => [item.id, item])).values()]
    .sort((a, b) => a.at - b.at)
    .slice(-KEEP)

const stored = async ($: EngineInterface) => {
  const value = await $.store.get(STORE_KEY)

  return Array.isArray(value) ? (value as Entry[]) : []
}

// One list shared by every session: read the store, merge, write it back.
// No lock: two sessions writing at the same instant can drop one entry.
const persist = async ($: EngineInterface, added: readonly Entry[] = []) => {
  const fromStore = await stored($)
  const merged = await update($, entries, list => mergeById(fromStore, list, added))
  await $.store.set(STORE_KEY, merged)
}

const record = async (
  $: EngineInterface,
  kind: Entry['kind'],
  fulls: readonly string[],
) => {
  if (fulls.length === 0) return
  const at = await $.clock.now()
  const session = await $.session.id()
  const added = fulls.map((full, i) => ({
    id: `${at}-${i}-${full}`,
    kind,
    name: kind === 'file' ? fileName(full) : linkName(full),
    full,
    at,
    session,
  }))
  await persist($, added)
}

const urlsIn = (text: string | undefined) => [
  ...new Set(text?.match(URLS) ?? []),
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'creations',
      description: 'Open or close the pane of files and links Claude created',
    })
    void $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
    await persist($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'creations' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: 'Creations pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })

    return { text: 'Creations pane opened.' }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (
      ran.deny === undefined &&
      ran.isError !== true &&
      ran.result.type === 'create' &&
      ran.result.staged !== true
    ) {
      await record($, 'file', [e.file_path])
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && GH_CREATE.test(e.command)) {
      await record($, 'link', urlsIn(ran.text))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    const isPublish = e.action === undefined || e.action === 'publish'
    if (ran.deny === undefined && ran.isError !== true && isPublish) {
      await record($, 'link', urlsIn(ran.text).filter(url => url.includes('claude.ai')))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, entries)
    const open = await read($, openId)
    const current = await $.session.id()
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 2)

    return (
      <Box flexDirection="column">
        <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
          Close
        </Button>
        {list.length === 0 && <Text dimColor>No files or links created yet.</Text>}
        {list
          .slice(-room)
          .reverse()
          .map(item => (
            <Box key={`row-${item.id}`} flexDirection="column">
              <Button
                key={item.id}
                plain
                onPress={() =>
                  update($, openId, cur => (cur === item.id ? null : item.id))
                }
              >
                <Text dimColor>{hhmmss(item.at)}</Text> {item.kind} {item.name}
                {item.session !== undefined && item.session !== current && (
                  <Text dimColor> [{item.session.slice(0, 4)}]</Text>
                )}
              </Button>
              {open === item.id && <Text color="cyan">  {item.full}</Text>}
            </Box>
          ))}
      </Box>
    )
  })
}
