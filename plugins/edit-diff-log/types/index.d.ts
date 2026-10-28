export type Change = {
  id: string
  path: string
  name: string
  at: number
  added: number
  removed: number
  patch: string
  session?: string
  // The folder the session ran in, its last path part.
  dir?: string
}

// Which sessions the pane lists; the choice is kept across sessions.
export type Scope = 'session' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'edit-diff-log': { changes: Shaped<Change[]>; openId: string | null; shownSession: string | null; scope: Scope }
  }
}
