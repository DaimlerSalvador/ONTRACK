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
  '--ontrack-surface': '#F5F7FA',
  '--ontrack-surface-elevated': '#FFFFFF',
  '--ontrack-border': '#94a3b8',
  '--ontrack-text': '#000000',
  '--ontrack-text-secondary': '#64748B',
  '--ontrack-text-muted': '#94A3B8',
  '--ontrack-primary': '#2563EB',
  '--ontrack-primary-hover': '#1D4ED8',
  '--ontrack-success': '#16A34A',
  '--ontrack-danger': '#DC2626',
  '--ontrack-info': '#2563EB',
  '--ontrack-input-bg': '#FFFFFF',
  '--ontrack-node-hidden-bg': '#E2E8F0',
  '--ontrack-node-hidden-text': '#64748B',
  '--ontrack-scrollbar-thumb': '#cbd5e1',
  '--ontrack-scrollbar-thumb-hover': '#94a3b8',
  '--ontrack-shadow': 'rgba(0,0,0,0.05)',
}

const DARK = {
  '--ontrack-bg': '#111111',
  '--ontrack-surface': '#1a1a1a',
  '--ontrack-surface-elevated': '#222222',
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
const ROOT_CSS = varsToCSS({ ...LIGHT, '--ontrack-bg': '#f4f4f5', '--ontrack-surface': '#ffffff' }, ':root')

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
