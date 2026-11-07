import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats } from '../types'

const isExpanded = atom({ plugin: 'usage-bar', key: 'isExpanded' } as const, false)
const stats = atom({ plugin: 'usage-bar', key: 'stats' } as const, null)
const idleSince = atom({ plugin: 'usage-bar', key: 'idleSince' } as const, null)
const now = atom({ plugin: 'usage-bar', key: 'now' } as const, 0)

// ponytail: fixed 1h TTL (Claude Code's subscription cache); make it an option if 5m users need it
const CACHE_TTL = 60 * 60 * 1000

// 1px line that fades out at both ends; mid-grey at low opacity reads on light and dark themes
const DIVIDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="80" viewBox="0 0 1 80">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#888" stop-opacity="0"/>' +
  '<stop offset="0.5" stop-color="#888" stop-opacity="0.45"/>' +
  '<stop offset="1" stop-color="#888" stop-opacity="0"/>' +
  '</linearGradient></defs><rect width="1" height="80" fill="url(#g)"/></svg>'

// SVG can't read theme keys, so the meter colors are fixed hex close to the theme's
const HEX: Record<string, string> = { claude: '#D97757', warning: '#E5B53A', error: '#E06C6C' }
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'

// ponytail: last drawn value per animated element; a redraw within 1.5s keeps the same start, so a
// re-render mid-animation doesn't cut it. Resets on reload (cosmetic only)
const memory = new Map<string, { value: string; from: string; at: number }>()
const startOf = (id: string, value: string) => {
  const at = Date.now()
  const m = memory.get(id)
  if (!m || m.value !== value) {
    memory.set(id, { value, from: m?.value ?? '', at })
    return m?.value ?? ''
  }
  return at - m.at < 1500 ? m.from : value
}

// Dots (limits) or line-then-dots (panels); a clip wipe glides from `from` to `fill`, off under reduced motion
const meterSvg = (
  fill: number, total: number, from: number, color: string, isLine: boolean, delay: number, isWorking: boolean,
) => {
  const step = isLine ? 9 : 10
  const w = total * step
  const h = isLine ? 8 : 10
  const cy = h / 2
  const dots = (r: number, pulse = false) =>
    Array.from({ length: total }, (_, i) => {
      const p = pulse && i < fill ? ` class="p" style="animation-delay:${i * 90}ms"` : ''
      return `<circle cx="${i * step + step / 2}" cy="${cy}" r="${r}"${p}/>`
    }).join('')
  const bright = isLine ? `<rect x="0" y="${cy - 1.5}" width="${w}" height="3" rx="1.5"/>` : dots(3, isWorking)
  const anim = from === fill ? '' : `animation:grow 300ms ${EASE_OUT} ${delay}ms both;`
  const keyframes = from === fill ? '' : `@keyframes grow{from{transform:scaleX(${from / total})}}`
  // working: filled dots swell one after another, a wave like a loading bar
  const pulse = isWorking
    ? `.p{transform-box:fill-box;transform-origin:center;animation:pulse 1200ms ${EASE_IN_OUT} infinite}` +
      `@keyframes pulse{0%,60%,100%{transform:scale(1)}30%{transform:scale(1.45)}}@keyframes dim{30%{opacity:0.4}}`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<style>.f{transform-origin:0 0;transform:scaleX(${fill / total});${anim}}${keyframes}${pulse}` +
    `@media (prefers-reduced-motion:reduce){.f{animation:none}.p{animation-name:dim}}</style>` +
    `<defs><clipPath id="c"><rect class="f" width="${w}" height="${h}"/></clipPath></defs>` +
    `<g fill="#888" fill-opacity="0.45">${dots(isLine ? 1.5 : 3)}</g>` +
    `<g fill="${color}" clip-path="url(#c)">${bright}</g></svg>`
  )
}

// Digits roll like slot reels to the new number; letters and dots stay put. Text follows light/dark mode.
// ponytail: glyph widths are estimates for a bold system font; tune `adv` if the number looks spaced out
const slotSvg = (text: string, prev: string) => {
  const size = 26
  const h = 32
  const adv = (c: string) => size * (/\d/.test(c) ? 0.62 : c === '.' ? 0.3 : c === 'M' ? 0.9 : 0.58)
  const keyframes: string[] = []
  let x = 0
  const cells = [...text].map((c, i) => {
    const w = adv(c)
    const cx = x + w / 2
    const left = x
    x += w
    if (!/\d/.test(c) || prev === text) return `<text x="${cx}" y="${size}">${c}</text>`
    const was = prev[prev.length - text.length + i] // the digit in the same place, counted from the right
    const old = was !== undefined && /\d/.test(was) ? Number(was) : 0
    const end = 10 + Number(c) // always at least one full turn
    keyframes.push(`@keyframes roll${i}{from{transform:translateY(${-old * h}px)}}`)
    const reel = Array.from({ length: 20 }, (_, k) => `<text x="${cx}" y="${size + k * h}">${k % 10}</text>`).join('')
    return (
      `<clipPath id="s${i}"><rect x="${left}" y="0" width="${w}" height="${h}"/></clipPath>` +
      `<g clip-path="url(#s${i})"><g class="r" style="transform:translateY(${-end * h}px);` +
      `animation:roll${i} 700ms ${EASE_OUT} ${i * 60}ms both">${reel}</g></g>`
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(x)}" height="${h}" viewBox="0 0 ${x} ${h}">` +
    `<style>text{font:700 ${size}px system-ui,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;` +
    `text-anchor:middle;fill:#1f1e1d}@media (prefers-color-scheme:dark){text{fill:#f5f4ef}}` +
    `${keyframes.join('')}@media (prefers-reduced-motion:reduce){.r{animation:none!important}}</style>` +
    `${cells.join('')}</svg>`
  )
}

const tokens = (n?: number) =>
  n === undefined ? '–'
  : n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M`
  : n >= 1e3 ? `${Math.round(n / 1e3)}k`
  : String(n)

const duration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t = await $.clock.now()
    await update($, now, () => t)
    await update($, idleSince, since => since ?? t)

    // ponytail: 15s tick redraws the countdowns; minute precision needs no faster
    $.clock.every(15000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const t = await $.clock.now()
    await update($, idleSince, () => t)
    await update($, now, () => t)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const api = context.breakdown?.apiUsage
    const limit = (kind: string) => e.rateLimits.find(r => r.kind === kind)
    const s: Stats = {
      fiveHour: limit('five_hour')?.percentUsed,
      fiveHourResetsAt: limit('five_hour')?.resetsAt,
      weekly: limit('seven_day')?.percentUsed,
      weeklyResetsAt: limit('seven_day')?.resetsAt,
      contextTokens: e.context.tokens,
      contextPercent: e.context.percent,
      window: e.context.window,
      cached: api ? api.cache_read_input_tokens + api.cache_creation_input_tokens : undefined,
    }
    await update($, stats, () => s)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // ponytail: the terminal lists an Svg element but draws nothing, so it keeps the text meters and gets no divider
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const s = await read($, stats)
    const open = await read($, isExpanded)
    const since = await read($, idleSince)
    const t = await read($, now)

    const idleMs = since === null ? 0 : Math.max(0, t - since)
    const cached = s?.cached ?? 0
    const isWarm = s?.cached !== undefined && (e.props.isWorking || idleMs < CACHE_TTL)

    const meter = (id: string, filled: number, total: number, color: string, mark = '●', delay = 0) => {
      const f = Math.min(total, Math.max(0, filled))
      if (!Svg) {
        return (
          <Box key={id}>
            <Text color={color}>{mark.repeat(f)}</Text>
            <Text color="subtle">{'·'.repeat(total - f)}</Text>
          </Box>
        )
      }
      const from = Number(startOf(id, String(f)) || 0)
      const isLine = mark === '━'
      const source = meterSvg(f, total, from, HEX[color] ?? color, isLine, delay, !isLine && e.props.isWorking)
      return <Svg key={id} source={source} alt={`${f} of ${total}`} />
    }

    const limit = (label: string, used: number | undefined, resetsAt: string | undefined, color: string) => {
      if (used === undefined) return <Text color="subtle">{label} –</Text>
      // the window reset after the last reply, so it's full until the next reply says otherwise
      const isReset = resetsAt !== undefined && Date.parse(resetsAt) <= t
      const pct = isReset ? 100 : Math.max(0, Math.round(100 - used))
      const tone = pct <= 10 ? 'error' : color
      return (
        <Box gap={1} alignItems="center">
          <Text color="subtle">{label}</Text>
          {meter(label, Math.round(pct / 20), 5, tone)}
          <Text color={tone} bold>{pct}% left</Text>
          {resetsAt && !isReset ? <Text color="subtle">· {duration(Date.parse(resetsAt) - t)}</Text> : null}
        </Box>
      )
    }

    const contextPct = Math.round(s?.contextPercent ?? 0)
    const contextTone = contextPct >= 80 ? 'error' : contextPct >= 60 ? 'warning' : 'claude'
    const context = s?.contextTokens === undefined ? <Text color="subtle">CTX –</Text> : (
      <Box gap={1} alignItems="center">
        <Text color="subtle">CTX</Text>
        {meter('CTX', Math.round(contextPct / 20), 5, contextTone)}
        <Text color={contextTone} bold>{tokens(s.contextTokens)}/{tokens(s.window)}</Text>
      </Box>
    )

    const top = (
      <Box flexGrow={1} justifyContent="space-between" alignItems="center">
        <Box gap={2} alignItems="center" flexWrap="wrap">
          {limit('7D', s?.weekly, s?.weeklyResetsAt, 'claude')}
          {limit('5H', s?.fiveHour, s?.fiveHourResetsAt, 'warning')}
          {context}
        </Box>
        <Box gap={1} alignItems="center">
          {/* compacting is refused while a turn runs, so the button is hidden until the reply ends */}
          {e.props.isWorking ? null : (
            <Button key="compact" label="Compact" onPress={() => void $.session.compact().catch(() => {})} />
          )}
          <Button key="toggle" label={open ? 'Hide' : 'Show'} onPress={() => update($, isExpanded, v => !v)} />
        </Box>
      </Box>
    )

    if (!open) {
      memory.delete('idle')
      memory.delete('cache')
      memory.delete('cache-number')
      return (
        <Box paddingX="md" paddingY="xs">
          {top}
        </Box>
      )
    }

    const heading = (text: string) => <Text color="subtle" size="caption" bold>{text}</Text>
    const big = (text: string) => <Text size="title" weight="bold">{text}</Text>
    const caption = (text: string) => <Text color="subtle" size="caption">{text}</Text>
    const slot = (id: string, text: string) =>
      Svg ? <Svg key={id} source={slotSvg(text, startOf(id, text))} alt={text} /> : big(text)
    const cachedPct = s?.window ? Math.round((cached / s.window) * 100) : 0

    return (
      <Box flexDirection="column" gap="sm" paddingX="md" paddingY="xs">
        {top}
        <Box gap="md" alignItems="center">
          <Box flexDirection="column" flexGrow={1} gap="xs">
            {heading('IDLE')}
            {big(e.props.isWorking ? 'Working' : since === null ? '–' : duration(idleMs))}
            {meter('idle', Math.round((idleMs / CACHE_TTL) * 20), 20, 'error', '━')}
            {caption('since last reply')}
          </Box>
          {Svg ? <Svg source={DIVIDER} alt="Section divider" width={1} height={80} /> : null}
          <Box flexDirection="column" flexGrow={1} gap="xs">
            {heading('IN CACHE')}
            <Box gap={1} alignItems="flex-end">
              {slot('cache-number', isWarm ? tokens(cached) : '0')}
              <Text color="subtle">tokens</Text>
            </Box>
            {meter('cache', isWarm ? Math.round(cachedPct / 5) : 0, 20, 'error', '━', 50)}
            {caption(isWarm ? `${cachedPct}% of the ${tokens(s?.window)} context` : 'expired after 1h idle')}
          </Box>
        </Box>
      </Box>
    )
  })
}
