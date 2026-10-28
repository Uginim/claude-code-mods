export type Format = 'tsv' | 'csv' | 'md' | 'art' | 'html' | 'png'

declare module 'claude-code' {
  interface PluginState {
    'table-export': { openId: string | null }
  }
}
