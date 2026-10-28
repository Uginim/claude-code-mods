export type Change = {
  id: string
  path: string
  name: string
  at: number
  added: number
  removed: number
  patch: string
  session?: string
}

declare module 'claude-code' {
  interface PluginState {
    'edit-diff-log': { changes: Shaped<Change[]>; openId: string | null }
  }
}
