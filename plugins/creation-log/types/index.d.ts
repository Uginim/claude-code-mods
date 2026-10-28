export type Entry = {
  id: string
  kind: 'file' | 'link'
  name: string
  full: string
  at: number
  session?: string
  // The folder the session ran in, its last path part.
  dir?: string
}

declare module 'claude-code' {
  interface PluginState {
    'creation-log': { entries: Shaped<Entry[]>; openId: string | null; shownSession: string | null }
  }
}
