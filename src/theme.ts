/**
 * Theme utilities for OnTrack.
 *
 * Uses a dynamic <style> element with !important rules to override
 * inline styles reliably across all pages.
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

export function applyTheme(target: Theme): void {
  const html = document.documentElement
  html.setAttribute('data-theme', target)
  localStorage.setItem('ontrack_theme', target)

  // Remove existing theme override style if present
  const existing = document.getElementById('theme-overrides')
  if (existing) existing.remove()

  const style = document.createElement('style')
  style.id = 'theme-overrides'

  if (target === 'light') {
    style.textContent = `
      /* Base colors */
      [data-theme="light"] body {
        background: #f4f4f5 !important;
        color: #18181b !important;
      }

      /* Background overrides - all dark backgrounds become light */
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
      [data-theme="light"] [style*="background:#1c1c1c"],
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

      [data-theme="light"] [style*="background: #0e0e0e"],
      [data-theme="light"] [style*="background:#0e0e0e"] {
        background: #ffffff !important;
      }

      [data-theme="light"] [style*="background: #f2f2f2"],
      [data-theme="light"] [style*="background:#f2f2f2"] {
        background: #f4f4f5 !important;
      }

      /* Border overrides */
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

      /* Text color overrides - light text becomes dark */
      [data-theme="light"] [style*="color: #f0f0f0"],
      [data-theme="light"] [style*="color:#f0f0f0"],
      [data-theme="light"] [style*="color: #f5f5f5"],
      [data-theme="light"] [style*="color:#f5f5f5"],
      [data-theme="light"] [style*="color: #ffffff"],
      [data-theme="light"] [style*="color:#ffffff"] {
        color: #18181b !important;
      }

      /* Secondary text colors */
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

      /* Scrollbar */
      [data-theme="light"] ::-webkit-scrollbar-thumb {
        background: #d4d4d8 !important;
      }
      [data-theme="light"] ::-webkit-scrollbar-thumb:hover {
        background: #a1a1aa !important;
      }

      /* SVG strokes in landing page */
      [data-theme="light"] svg ellipse {
        stroke: #d4d4d8 !important;
      }
    `
  } else {
    style.textContent = `
      [data-theme="dark"] body {
        background: #111111 !important;
        color: #f0f0f0 !important;
      }
      [data-theme="dark"] ::-webkit-scrollbar-thumb {
        background: #2a2a2a !important;
      }
      [data-theme="dark"] ::-webkit-scrollbar-thumb:hover {
        background: #3a3a3a !important;
      }
    `
  }

  document.head.appendChild(style)
}

export function stopThemeObserver(): void {
  const existing = document.getElementById('theme-overrides')
  if (existing) existing.remove()
}
