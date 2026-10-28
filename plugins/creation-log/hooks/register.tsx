import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Scope } from '../types'

const PANE = 'creation-log'
const TITLE = 'Creations'
const URLS = /https?:\/\/[^\s"'`<>)\]]+/g
// Only `gh ... create` commands count as links; add other CLIs here when needed.
const GH_CREATE = /\bgh\s+(gist|pr|issue|release|repo)\s+create\b/

const entries = atom({ plugin: 'creation-log', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
const openId = atom({ plugin: 'creation-log', key: 'openId' } as const, null)
const shownSession = atom({ plugin: 'creation-log', key: 'shownSession' } as const, null)
const scope = atom({ plugin: 'creation-log', key: 'scope' } as const, 'all' as Scope)
const SCOPE_KEY = 'scope'

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

// Opening a script or an app runs it, so those only get shown in their folder.
const RUNS_WHEN_OPENED = /\.(app|command|tool|sh|bash|zsh|csh|pkg|mpkg|dmg|exe|msi|bat|cmd|ps1|scpt|applescript|workflow|jar|terminal|desktop|appimage)$/i

// The first command that runs and exits 0 wins: macOS `open`, then `xdg-open` elsewhere.
const runFirst = async ($: EngineInterface, ...argvs: string[][]) => {
  for (const argv of argvs) {
    try {
      if ((await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0) return true
    } catch {
      // Not installed here; try the next one.
    }
  }

  return false
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

const summarize = (items: readonly Entry[]) => {
  const files = items.filter(item => item.kind === 'file').length
  const links = items.length - files

  return [files && plural(files, 'file'), links && plural(links, 'link')].filter(Boolean).join(', ')
}

// The remembered choice of `This session` / `All sessions`, read into the session at start.
const loadScope = async ($: EngineInterface) => {
  const value = await $.store.get(SCOPE_KEY)
  await update($, scope, () => (value === 'session' ? 'session' : 'all'))
}
const chooseScope = async ($: EngineInterface, next: Scope) => {
  await update($, scope, () => next)
  await $.store.set(SCOPE_KEY, next)
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
  const dir = await $.session.cwd().then(fileName, () => undefined)
  const added = fulls.map((full, i) => ({
    id: `${at}-${i}-${full}`,
    kind,
    name: kind === 'file' ? fileName(full) : linkName(full),
    full,
    at,
    session,
    dir,
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
    await Promise.all([persist($), loadScope($)])

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
    const shown = await read($, shownSession)
    const only = (await read($, scope)) === 'session'
    const groups = groupBySession(list, await $.session.id())
    const hidden = groups.filter(group => !group.isCurrent).length
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 2)
    const toast = (text: string) => $.ui.toast(text)

    const actions = (item: Entry) => {
      const copyLabel = item.kind === 'file' ? 'path' : 'URL'
      const copy = async () => {
        const copied = await $.ui.copy({ text: item.full, surface: e.surface })
        await toast(copied.isCopied ? `Copied ${copyLabel}.` : `Not copied: ${copied.reason ?? 'no clipboard'}`)
      }
      const openIt = async () => {
        if (!(await runFirst($, ['open', item.full], ['xdg-open', item.full]))) await toast(`Could not open ${item.full}`)
      }
      const reveal = async () => {
        if (!(await runFirst($, ['open', '-R', item.full], ['xdg-open', parentOf(item.full)])))
          await toast(`Could not show ${item.full}`)
      }
      const canOpen = item.kind === 'link' || !RUNS_WHEN_OPENED.test(item.full)

      return (
        <Box key={`act-${item.id}`} flexDirection="row" gap={1} paddingLeft={2}>
          {canOpen && (
            <Button key={`open-${item.id}`} onPress={openIt}>
              Open
            </Button>
          )}
          {item.kind === 'file' && (
            <Button key={`reveal-${item.id}`} onPress={reveal}>
              Show in folder
            </Button>
          )}
          <Button key={`copy-${item.id}`} onPress={copy}>
            Copy {copyLabel}
          </Button>
        </Box>
      )
    }

    const rows = (items: readonly Entry[]) =>
      items.slice(0, room).map(item => (
        <Box key={`row-${item.id}`} flexDirection="column">
          <Button key={item.id} plain onPress={() => update($, openId, cur => (cur === item.id ? null : item.id))}>
            <Text dimColor>{hhmmss(item.at)}</Text> {item.kind} {item.name}
          </Button>
          {open === item.id && <Text color="cyan">  {item.full}</Text>}
          {open === item.id && actions(item)}
        </Box>
      ))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
            Close
          </Button>
          <Button key="scope-session" variant={only ? 'primary' : undefined} onPress={() => chooseScope($, 'session')}>
            This session
          </Button>
          <Button key="scope-all" variant={only ? undefined : 'primary'} onPress={() => chooseScope($, 'all')}>
            All sessions
          </Button>
        </Box>
        {list.length === 0 && <Text dimColor>No files or links created yet.</Text>}
        {list.length > 0 && groups[0]?.isCurrent !== true && <Text dimColor>Nothing created in this session yet.</Text>}
        {only && hidden > 0 && <Text dimColor>{plural(hidden, 'earlier session')} hidden.</Text>}
        {groups.filter(group => !only || group.isCurrent).map(({ id, items, isCurrent }) =>
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
