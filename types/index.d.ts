export type Stats = {
  fiveHour?: number
  fiveHourResetsAt?: string
  weekly?: number
  weeklyResetsAt?: string
  contextTokens?: number
  contextPercent?: number
  window: number
  cached?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': {
      isExpanded: boolean
      stats: Stats | null
      idleSince: number | null
      now: number
    }
  }
}
