/**
 * Theme utilities for OnTrack.
 *
 * Uses a dynamic <style> element with !important rules to override
 * inline styles reliably, since CSS custom properties alone cannot
 * override inline styles without !important.
 */

export type Theme = 'light' | 'dark'

export function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  return (localStorage.getItem('ontrack_theme') as Theme) ?? 'dark'
}

export function applyTheme(theme: Theme): void {
  const html = document.documentElement
  html.setAttribute('data-theme', theme)
  localStorage.setItem('ontrack_theme', theme)

  // Remove existing theme override style if present
  const existing = document.getElementById('theme-overrides')
  if (existing) existing.remove()

  if (theme === 'light') {
    const style = document.createElement('style')
    style.id = 'theme-overrides'
    style.textContent = `
      [data-theme="light"] {
        --bg: #f4f4f5 !important;
        --surface: #ffffff !important;
        --surface-elevated: #f9fafb !important;
        --border: #e4e4e7 !important;
        --border-light: #d4d4d8 !important;
        --text: #18181b !important;
        --text-secondary: #71717a !important;
        --text-muted: #a1a1aa !important;
        --accent: #e84040 !important;
        --accent-hover: #dc2626 !important;
        --success: #16a34a !important;
        --warning: #d97706 !important;
        --info: #2563eb !important;
        --danger: #dc2626 !important;
        --input-bg: #ffffff !important;
        --scrollbar-thumb: #d4d4d8 !important;
        --scrollbar-thumb-hover: #a1a1aa !important;
      }

      [data-theme="light"] body {
        background: #f4f4f5 !important;
        color: #18181b !important;
      }

      [data-theme="light"] [style*="background: #111"],
      [data-theme="light"] [style*="background:#111"],
      [data-theme="light"] [style*="background: #0a0a0a"],
      [data-theme="light"] [style*="background:#0a0a0a"],
      [data-theme="light"] [style*="background: #0d0d0d"],
      [data-theme="light"] [style*="background:#0d0d0d"],
      [data-theme="light"] [style*="background: #131313"],
      [data-theme="light"] [style*="background:#131313"],
      [data-theme="light"] [style*="background: #161616"],
      [data-theme="light"] [style*="background:#161616"],
      [data-theme="light"] [style*="background: #171717"],
      [data-theme="light"] [style*="background:#171717"],
      [data-theme="light"] [style*="background: #181818"],
      [data-theme="light"] [style*="background:#181818"],
      [data-theme="light"] [style*="background: #1c1c1c"],
      [data-theme="light"] [style*="background:#1c1c1c"] {
        background: #ffffff !important;
      }

      [data-theme="light"] [style*="background: #1a1a1a"],
      [data-theme="light"] [style*="background:#1a1a1a"],
      [data-theme="light"] [style*="background: #191919"],
      [data-theme="light"] [style*="background:#191919"],
      [data-theme="light"] [style*="background: #222"],
      [data-theme="light"] [style*="background:#222"] {
        background: #ffffff !important;
      }

      [data-theme="light"] [style*="background: #252525"],
      [data-theme="light"] [style*="background:#252525"],
      [data-theme="light"] [style*="background: #2a2a2a"],
      [data-theme="light"] [style*="background:#2a2a2a"],
      [data-theme="light"] [style*="background: #333"],
      [data-theme="light"] [style*="background:#333"] {
        background: #f9fafb !important;
      }

      [data-theme="light"] [style*="border: 1px solid #1e1e1e"],
      [data-theme="light"] [style*="border:1px solid #1e1e1e"],
      [data-theme="light"] [style*="border: 1px solid #252525"],
      [data-theme="light"] [style*="border:1px solid #252525"],
      [data-theme="light"] [style*="border: 1px solid #2a2a2a"],
      [data-theme="light"] [style*="border:1px solid #2a2a2a"],
      [data-theme="light"] [style*="border: 1px solid #333"],
      [data-theme="light"] [style*="border:1px solid #333"] {
        border-color: #e4e4e7 !important;
      }

      [data-theme="light"] [style*="borderBottom: 1px solid #1e1e1e"],
      [data-theme="light"] [style*="border-bottom: 1px solid #1e1e1e"],
      [data-theme="light"] [style*="borderBottom: 1px solid #171717"],
      [data-theme="light"] [style*="border-bottom: 1px solid #171717"],
      [data-theme="light"] [style*="borderRight: 1px solid #e0e0e0"],
      [data-theme="light"] [style*="border-right: 1px solid #e0e0e0"] {
        border-color: #e4e4e7 !important;
      }

      [data-theme="light"] [style*="color: #f0f0f0"],
      [data-theme="light"] [style*="color:#f0f0f0"],
      [data-theme="light"] [style*="color: #f5f5f5"],
      [data-theme="light"] [style*="color:#f5f5f5"],
      [data-theme="light"] [style*="color: #ffffff"],
      [data-theme="light"] [style*="color:#ffffff"] {
        color: #18181b !important;
      }

      [data-theme="light"] [style*="color: #666"],
      [data-theme="light"] [style*="color:#666"],
      [data-theme="light"] [style*="color: #555"],
      [data-theme="light"] [style*="color:#555"],
      [data-theme="light"] [style*="color: #444"],
      [data-theme="light"] [style*="color:#444"],
      [data-theme="light"] [style*="color: #aaa"],
      [data-theme="light"] [style*="color:#aaa"],
      [data-theme="light"] [style*="color: #ccc"],
      [data-theme="light"] [style*="color:#ccc"],
      [data-theme="light"] [style*="color: #777"],
      [data-theme="light"] [style*="color:#777"],
      [data-theme="light"] [style*="color: #888"],
      [data-theme="light"] [style*="color:#888"] {
        color: #71717a !important;
      }

      [data-theme="light"] [style*="background: #0e0e0e"],
      [data-theme="light"] [style*="background:#0e0e0e"] {
        background: #ffffff !important;
      }

      [data-theme="light"] [style*="background: #f2f2f2"],
      [data-theme="light"] [style*="background:#f2f2f2"] {
        background: #f4f4f5 !important;
      }

      [data-theme="light"] ::-webkit-scrollbar-thumb {
        background: #d4d4d8 !important;
      }
      [data-theme="light"] ::-webkit-scrollbar-thumb:hover {
        background: #a1a1aa !important;
      }
    `
    document.head.appendChild(style)
  } else {
    // Dark mode: remove the light mode overrides
    const style = document.createElement('style')
    style.id = 'theme-overrides'
    style.textContent = `
      [data-theme="dark"] body {
        background: #111111 !important;
        color: #f0f0f0 !important;
      }
    `
    document.head.appendChild(style)
  }
}

export function stopThemeObserver(): void {
  const existing = document.getElementById('theme-overrides')
  if (existing) existing.remove()
}
