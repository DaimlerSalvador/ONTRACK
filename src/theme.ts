/**
 * Theme utilities for OnTrack.
 *
 * Uses a MutationObserver to walk the DOM and patch inline styles
 * directly, which is more reliable than CSS selectors for overriding
 * React-set inline styles.
 */

export type Theme = 'light' | 'dark'

export function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light'
  return (localStorage.getItem('ontrack_theme') as Theme) ?? 'light'
}

const DARK_TO_LIGHT: Record<string, string> = {
  '#111111': '#f4f4f5',
  '#111': '#f4f4f5',
  '#0a0a0a': '#f4f4f5',
  '#0d0d0d': '#ffffff',
  '#131313': '#ffffff',
  '#161616': '#ffffff',
  '#171717': '#ffffff',
  '#181818': '#ffffff',
  '#191919': '#ffffff',
  '#1a1a1a': '#ffffff',
  '#1c1c1c': '#ffffff',
  '#222222': '#f9fafb',
  '#222': '#f9fafb',
  '#252525': '#f9fafb',
  '#2a2a2a': '#f9fafb',
  '#333333': '#f9fafb',
  '#333': '#f9fafb',
  '#e0e0e0': '#e4e4e7',
  '#e4e4e4': '#e4e4e7',
  '#f0f0f0': '#18181b',
  '#f5f5f5': '#18181b',
  '#ffffff': '#18181b',
  '#fff': '#18181b',
  '#aaa': '#71717a',
  '#aaaaaa': '#71717a',
  '#ccc': '#71717a',
  '#777': '#71717a',
  '#888': '#71717a',
  '#666666': '#71717a',
  '#666': '#71717a',
  '#555': '#71717a',
  '#444': '#71717a',
  '#0e0e0e': '#ffffff',
  '#f2f2f2': '#f4f4f5',
}

const LIGHT_TO_DARK: Record<string, string> = Object.fromEntries(
  Object.entries(DARK_TO_LIGHT).map(([k, v]) => [v, k])
) as Record<string, string>

function patchStyle(style: string, mapping: Record<string, string>): string {
  let result = style
  for (const [from, to] of Object.entries(mapping)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'g')
    if (regex.test(result)) {
      result = result.replace(regex, to)
    }
  }
  return result
}

function walkAndPatch(node: Node, mapping: Record<string, string>): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    // Skip auth pages - keep them dark
    if (el.hasAttribute('data-auth')) {
      for (const child of node.childNodes) {
        walkAndPatch(child, mapping)
      }
      return
    }
    const style = el.getAttribute('style')
    if (style && !el.getAttribute('data-theme-patched')) {
      const patched = patchStyle(style, mapping)
      if (patched !== style) {
        el.setAttribute('style', patched)
        el.setAttribute('data-theme-patched', 'true')
      }
    }
  }
  for (const child of node.childNodes) {
    walkAndPatch(child, mapping)
  }
}

export function applyTheme(target: Theme): void {
  const html = document.documentElement
  html.setAttribute('data-theme', target)
  localStorage.setItem('ontrack_theme', target)

  // Remove old patched markers and observer
  document.querySelectorAll('[data-theme-patched]').forEach(el => {
    el.removeAttribute('data-theme-patched')
  })
  stopThemeObserver()

  const mapping = target === 'light' ? DARK_TO_LIGHT : LIGHT_TO_DARK

  // Initial patch
  walkAndPatch(html, mapping)

  // Re-patch after React re-renders
  const observer = new MutationObserver(() => {
    walkAndPatch(html, mapping)
  })
  observer.observe(html, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  ;(html as any)._themeObserver = observer
}

export function stopThemeObserver(): void {
  const html = document.documentElement
  const observer = (html as any)._themeObserver
  if (observer) {
    observer.disconnect()
    ;(html as any)._themeObserver = null
  }
  document.querySelectorAll('[data-theme-patched]').forEach(el => {
    el.removeAttribute('data-theme-patched')
  })
}
