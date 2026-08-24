import { useRef, useState } from 'react'

const STORAGE_KEY = 'dsh.worktable.appearance.v1'
const LEGACY_USAGE_KEY = 'dsh-usage:settings:v2'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_DATA_URL_LENGTH = 1_800_000

type Fit = 'cover' | 'contain'
type Position = 'center' | 'top' | 'bottom' | 'left' | 'right'
type SurfaceAppearance = {
  background: string
  image: string | null
  imageOpacity: number
  overlayOpacity: number
  imageBlur: number
  imageSize: Fit
  imagePosition: Position
  surfaceOpacity: number
}
type Appearance = {
  web: SurfaceAppearance & { accent: string }
  sidebar: SurfaceAppearance & { followWeb: boolean; accent: string }
  migration?: { fromUsageV2: boolean }
}

const baseSurface = (): SurfaceAppearance => ({
  background: '#050b1a', image: null, imageOpacity: 0, overlayOpacity: 0.62,
  imageBlur: 0, imageSize: 'cover', imagePosition: 'center', surfaceOpacity: 0.84,
})

const defaults = (): Appearance => ({
  web: { ...baseSurface(), accent: '#5278ff' },
  sidebar: { ...baseSurface(), accent: '#5278ff', background: '#071225', overlayOpacity: 0.68, surfaceOpacity: 0.88, followWeb: true },
})

const clamp = (value: unknown, fallback: number, min = 0, max = 1) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

const image = (value: unknown) =>
  typeof value === 'string' && value.length <= MAX_DATA_URL_LENGTH && /^data:image\/(?:webp|jpeg|png);base64,/i.test(value) ? value : null

function normalizeSurface(value: any, fallback: SurfaceAppearance): SurfaceAppearance {
  return {
    background: color(value?.background, fallback.background),
    image: image(value?.image),
    imageOpacity: clamp(value?.imageOpacity, fallback.imageOpacity),
    overlayOpacity: clamp(value?.overlayOpacity, fallback.overlayOpacity),
    imageBlur: clamp(value?.imageBlur, fallback.imageBlur, 0, 32),
    imageSize: value?.imageSize === 'contain' ? 'contain' : 'cover',
    imagePosition: ['center', 'top', 'bottom', 'left', 'right'].includes(value?.imagePosition) ? value.imagePosition : fallback.imagePosition,
    surfaceOpacity: clamp(value?.surfaceOpacity, fallback.surfaceOpacity, 0.18, 1),
  }
}

function normalize(value: any): Appearance {
  const fallback = defaults()
  return {
    web: { ...normalizeSurface(value?.web, fallback.web), accent: color(value?.web?.accent, fallback.web.accent) },
    sidebar: { ...normalizeSurface(value?.sidebar, fallback.sidebar), accent: color(value?.sidebar?.accent, fallback.sidebar.accent), followWeb: value?.sidebar?.followWeb !== false },
    migration: value?.migration?.fromUsageV2 ? { fromUsageV2: true } : undefined,
  }
}

function migrateLegacy(): Appearance | null {
  const raw = localStorage.getItem(LEGACY_USAGE_KEY)
  if (!raw) return null
  try {
    const legacy = JSON.parse(raw)
    const theme = legacy?.theme
    if (!theme || typeof theme !== 'object') return null
    const next = defaults()
    next.web = normalize({ web: {
      accent: theme.accent, background: theme.background ?? next.web.background,
      image: theme.backgroundImage, imageOpacity: theme.backgroundImageOpacity,
      overlayOpacity: theme.backgroundOverlay, imageBlur: theme.backgroundBlur,
      imageSize: theme.backgroundSize, imagePosition: theme.backgroundPosition,
      surfaceOpacity: theme.opacity,
    } }).web
    next.migration = { fromUsageV2: true }
    return next
  } catch { return null }
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalize(JSON.parse(raw))
    const migrated = migrateLegacy()
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return migrated
    }
  } catch { /* localStorage can be disabled; defaults remain usable. */ }
  return defaults()
}

function cssImage(value: string | null) { return value ? `url(${JSON.stringify(value)})` : 'none' }

export function applyAppearance(value: Appearance) {
  const root = document.documentElement
  const sidebar = value.sidebar.followWeb ? value.web : value.sidebar
  const setSurface = (prefix: 'web' | 'sidebar', surface: SurfaceAppearance) => {
    root.style.setProperty(`--dsh-${prefix}-bg`, surface.background)
    root.style.setProperty(`--dsh-${prefix}-image`, cssImage(surface.image))
    root.style.setProperty(`--dsh-${prefix}-image-opacity`, String(surface.imageOpacity))
    root.style.setProperty(`--dsh-${prefix}-overlay-opacity`, String(surface.overlayOpacity))
    root.style.setProperty(`--dsh-${prefix}-image-blur`, `${surface.imageBlur}px`)
    root.style.setProperty(`--dsh-${prefix}-image-size`, surface.imageSize)
    root.style.setProperty(`--dsh-${prefix}-image-position`, surface.imagePosition)
    root.style.setProperty(`--dsh-${prefix}-surface-opacity`, String(surface.surfaceOpacity))
  }
  root.style.setProperty('--dsh-web-accent', value.web.accent)
  root.style.setProperty('--dsh-sidebar-accent', value.sidebar.followWeb ? value.web.accent : value.sidebar.accent)
  setSurface('web', value.web)
  setSurface('sidebar', sidebar)
}

function saveAppearance(value: Appearance) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  applyAppearance(value)
}

function optimizeImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('type'))
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error('size'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const source = new Image()
    source.onload = () => {
      try {
        const scale = Math.min(1, 2560 / Math.max(source.naturalWidth, source.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(source.naturalHeight * scale))
        canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
        let quality = 0.86
        let mime = 'image/webp'
        let data = canvas.toDataURL(mime, quality)
        if (!data.startsWith('data:image/webp')) { mime = 'image/jpeg'; data = canvas.toDataURL(mime, quality) }
        while (data.length > MAX_DATA_URL_LENGTH && quality > 0.5) { quality -= 0.08; data = canvas.toDataURL(mime, quality) }
        data.length <= MAX_DATA_URL_LENGTH ? resolve(data) : reject(new Error('storage'))
      } catch { reject(new Error('decode')) } finally { URL.revokeObjectURL(url) }
    }
    source.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    source.src = url
  })
}

function Range({ label, value, min = 0, max = 1, step = 0.05, unit = '%', onChange }: any) {
  const shown = unit === '%' ? `${Math.round(value * 100)}%` : `${value}${unit}`
  return <label className="dsh-appearance_row"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/><output>{shown}</output></label>
}

function SurfaceEditor({ title, value, disabled = false, onChange, t }: any) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const patch = (part: Partial<SurfaceAppearance>) => onChange({ ...value, ...part })
  const pick = async (file?: File) => {
    if (!file) return
    setError('')
    try { patch({ image: await optimizeImage(file), imageOpacity: value.imageOpacity || 0.72 }) }
    catch (cause: any) { setError(t(`appearance.error.${cause?.message === 'size' ? 'size' : cause?.message === 'storage' ? 'storage' : 'image'}`)) }
  }
  return <fieldset className="dsh-appearance_group" disabled={disabled}>
    <legend>{title}</legend>
    <label className="dsh-appearance_color"><span>{t('appearance.background')}</span><input type="color" value={value.background} onChange={(e) => patch({ background: e.target.value })}/><code>{value.background}</code></label>
    <div className="dsh-appearance_upload"><span>{t('appearance.image')}</span><input ref={input} hidden type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])}/><button type="button" onClick={() => input.current?.click()}>{t('appearance.choose')}</button><button type="button" disabled={!value.image} onClick={() => patch({ image: null, imageOpacity: 0 })}>{t('appearance.clear')}</button></div>
    <Range label={t('appearance.imageOpacity')} value={value.imageOpacity} onChange={(imageOpacity: number) => patch({ imageOpacity })}/>
    <Range label={t('appearance.overlay')} value={value.overlayOpacity} onChange={(overlayOpacity: number) => patch({ overlayOpacity })}/>
    <Range label={t('appearance.surface')} value={value.surfaceOpacity} min={0.18} onChange={(surfaceOpacity: number) => patch({ surfaceOpacity })}/>
    <Range label={t('appearance.blur')} value={value.imageBlur} min={0} max={32} step={1} unit="px" onChange={(imageBlur: number) => patch({ imageBlur })}/>
    <label className="dsh-appearance_select"><span>{t('appearance.fit')}</span><select value={value.imageSize} onChange={(e) => patch({ imageSize: e.target.value as Fit })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label>
    <label className="dsh-appearance_select"><span>{t('appearance.position')}</span><select value={value.imagePosition} onChange={(e) => patch({ imagePosition: e.target.value as Position })}>{['center','top','bottom','left','right'].map((position) => <option key={position} value={position}>{t(`appearance.position.${position}`)}</option>)}</select></label>
    {error && <p className="dsh-appearance_error" role="alert">{error}</p>}
  </fieldset>
}

export function AppearanceSection(props: any) {
  const t = (key: string) => { try { return props.t?.(key) ?? key } catch { return key } }
  const [settings, setSettings] = useState(loadAppearance)
  const update = (next: Appearance) => { const normalized = normalize(next); setSettings(normalized); try { saveAppearance(normalized) } catch { /* retain live preview if storage is full. */ applyAppearance(normalized) } }
  return <div className="dsh-appearance">
    <header><div><h2>{t('appearance.title')}</h2><p>{t('appearance.description')}</p></div></header>
    <label className="dsh-appearance_color dsh-appearance_accent"><span>{t('appearance.accent')}</span><input type="color" value={settings.web.accent} onChange={(e) => update({ ...settings, web: { ...settings.web, accent: e.target.value } })}/><code>{settings.web.accent}</code></label>
    <SurfaceEditor title={t('appearance.web')} value={settings.web} t={t} onChange={(web: Appearance['web']) => update({ ...settings, web })}/>
    <div className="dsh-appearance_sidebarHead"><strong>{t('appearance.sidebar')}</strong><label><input type="checkbox" checked={settings.sidebar.followWeb} onChange={(e) => update({ ...settings, sidebar: { ...settings.sidebar, followWeb: e.target.checked } })}/>{t('appearance.followWeb')}</label></div>
    <label className="dsh-appearance_color dsh-appearance_accent"><span>{t('appearance.sidebarAccent')}</span><input disabled={settings.sidebar.followWeb} type="color" value={settings.sidebar.accent} onChange={(e) => update({ ...settings, sidebar: { ...settings.sidebar, accent: e.target.value } })}/><code>{settings.sidebar.accent}</code></label>
    <SurfaceEditor title={t('appearance.sidebarIndependent')} disabled={settings.sidebar.followWeb} value={settings.sidebar} t={t} onChange={(sidebar: Appearance['sidebar']) => update({ ...settings, sidebar })}/>
    <div className="dsh-appearance_actions"><button type="button" onClick={() => update({ ...settings, web: defaults().web })}>{t('appearance.resetWeb')}</button><button type="button" onClick={() => update({ ...settings, sidebar: defaults().sidebar })}>{t('appearance.resetSidebar')}</button></div>
  </div>
}

export function installAppearance(ctx: any, t: (key: string) => string) {
  applyAppearance(loadAppearance())
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) applyAppearance(loadAppearance()) }
  window.addEventListener('storage', onStorage)
  ctx.effect(() => () => window.removeEventListener('storage', onStorage), 'dsh-worktable: appearance sync')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'appearance', order: 5, label: () => t('appearance.nav'), locale: 'worktable',
  }, AppearanceSection), 'dsh-worktable: appearance settings')
}
