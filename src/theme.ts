export type Theme = 'light' | 'dark'

export function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light'
  return (localStorage.getItem('ontrack_theme') as Theme) ?? 'light'
}

const LIGHT = {
  '--ontrack-bg': '#FFFFFF',
  '--ontrack-surface': '#F2F2F2',
  '--ontrack-surface-elevated': '#FFFFFF',
  '--ontrack-surface-alt': '#E8E8E8',
  '--ontrack-border': '#B0B0B0',
  '--ontrack-text': '#1A1A1A',
  '--ontrack-text-secondary': '#595959',
  '--ontrack-text-muted': '#8C8C8C',
  '--ontrack-primary': '#C00000',
  '--ontrack-primary-hover': '#A30000',
  '--ontrack-primary-tint': '#FBEAEA',
  '--ontrack-success': '#16A34A',
  '--ontrack-danger': '#DC2626',
  '--ontrack-info': '#2563EB',
  '--ontrack-input-bg': '#FFFFFF',
  '--ontrack-node-hidden-bg': '#F2F2F2',
  '--ontrack-node-hidden-text': '#8C8C8C',
  '--ontrack-scrollbar-thumb': '#B0B0B0',
  '--ontrack-scrollbar-thumb-hover': '#8C8C8C',
  '--ontrack-shadow': 'rgba(0,0,0,0.10)',
}

const DARK = {
  '--ontrack-bg': '#111111',
  '--ontrack-surface': '#1a1a1a',
  '--ontrack-surface-elevated': '#222222',
  '--ontrack-surface-alt': '#2a2a2a',
  '--ontrack-border': '#2a2a2a',
  '--ontrack-border-light': '#333333',
  '--ontrack-text': '#f0f0f0',
  '--ontrack-text-secondary': '#aaaaaa',
  '--ontrack-text-muted': '#666666',
  '--ontrack-primary': '#e84040',
  '--ontrack-primary-hover': '#dc2626',
  '--ontrack-success': '#22c55e',
  '--ontrack-danger': '#dc2626',
  '--ontrack-info': '#2563eb',
  '--ontrack-input-bg': '#0e0e0e',
  '--ontrack-node-hidden-bg': '#222',
  '--ontrack-node-hidden-text': '#555',
  '--ontrack-scrollbar-thumb': '#2a2a2a',
  '--ontrack-scrollbar-thumb-hover': '#3a3a3a',
  '--ontrack-shadow': 'rgba(0,0,0,0.35)',
}


function varsToCSS(vars: Record<string, string>, selector: string): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${selector} { ${key}: ${value} !important; }`)
  }
  return lines.join('\n')
}

const LIGHT_CSS = varsToCSS(LIGHT, 'html[data-theme="light"]')
const DARK_CSS = varsToCSS(DARK, 'html[data-theme="dark"]')
const ROOT_CSS = varsToCSS({ ...LIGHT, '--ontrack-bg': '#FFFFFF', '--ontrack-surface': '#F2F2F2' }, ':root')

export function applyTheme(target: Theme): void {
  const html = document.documentElement
  html.setAttribute('data-theme', target)
  localStorage.setItem('ontrack_theme', target)

  let styleEl = document.getElementById('ontrack-theme-vars') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'ontrack-theme-vars'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = `${ROOT_CSS}\n${LIGHT_CSS}\n${DARK_CSS}`
}

export function stopThemeObserver(): void {
  const styleEl = document.getElementById('ontrack-theme-vars')
  if (styleEl) {
    styleEl.remove()
  }
}
