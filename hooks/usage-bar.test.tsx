import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-bar',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const NOW = 1_800_000_000_000
const MIN = 60_000

test('badge shows limits and cache; expanded adds idle, cache and cost', async ($, on) => {
  const values: Record<string, unknown> = {
    stats: {
      fiveHour: 11, fiveHourResetsAt: new Date(NOW + 143 * MIN).toISOString(),
      weekly: 58, weeklyResetsAt: new Date(NOW + (3 * 1440 + 12 * 60) * MIN).toISOString(),
      window: 1_000_000, cached: 182_000, contextTokens: 412_000, contextPercent: 41.2,
    },
    idleSince: NOW - 33 * MIN,
    now: NOW,
    isExpanded: false,
  }
  on('state.get', (_, e) => ({ value: { value: values[e.key], version: 1 } }))
  let compacts = 0
  on('session.compact', () => { compacts++; return { skip: 'test' } })

  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /89% left/ }))?.text).toBe('89% left')
  expect((await ui.find({ type: 'Text', text: /42% left/ }))?.text).toBe('42% left')
  expect((await ui.find({ type: 'Text', text: /2h 23m/ }))?.text).toBe('· 2h 23m')
  expect((await ui.find({ type: 'Text', text: /3d 12h/ }))?.text).toBe('· 3d 12h')
  expect(await ui.find({ type: 'Text', text: /WARM/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /IN CACHE/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /412k/ }))?.text).toBe('412k/1M')
  expect(await ui.find({ type: 'Text', text: /used/ })).toBeUndefined()
  await ui.press({ key: 'compact' })
  expect(compacts).toBe(1)
  await ui.unmount()

  values.isExpanded = true
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^33m$/ }))?.text).toBe('33m')
  expect((await term.find({ type: 'Text', text: /since last reply/ }))?.text).toBe('since last reply')
  expect((await term.find({ type: 'Text', text: /^182k$/ }))?.text).toBe('182k')
  expect((await term.find({ type: 'Text', text: /context/ }))?.text).toBe('18% of the 1M context')
  expect(await term.find({ type: 'Text', text: /NEXT MESSAGE/ })).toBeUndefined()
  await term.unmount()
})

test('a limit whose reset time has passed shows 100% left', async ($, on) => {
  const values: Record<string, unknown> = {
    stats: { fiveHour: 80, fiveHourResetsAt: new Date(NOW - MIN).toISOString(), window: 1_000_000 },
    idleSince: NOW,
    now: NOW,
    isExpanded: false,
  }
  on('state.get', (_, e) => ({ value: { value: values[e.key], version: 1 } }))

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /% left/ }))?.text).toBe('100% left')
  expect(await ui.find({ type: 'Text', text: /^·/ })).toBeUndefined()
  await ui.unmount()
})
