/**
 * Firebase initialization using the npm-installed compat SDK.
 */

import firebase from 'firebase/compat/app'
import 'firebase/compat/firestore'

declare global {
  interface Window {
    firebaseFirestore?: any
  }

  interface WindowEventMap {
    'firebase-ready': CustomEvent<{ ok: boolean }>
  }
}

const firebaseConfig = {
  apiKey: "AIzaSyAkVR_Fvvg8Qcqlovi3k4UGJdeaK4jHxNI",
  authDomain: "ontrack-925fe.firebaseapp.com",
  projectId: "ontrack-925fe",
  storageBucket: "ontrack-925fe.firebasestorage.app",
  messagingSenderId: "394468623022",
  appId: "1:394468623022:web:e4d6c4dda594baafcba33f",
  measurementId: "G-FSSL7MCJ6M"
} as const

export const hasFirebaseConfig = true

let app: firebase.app.App | null = null

export function initFirebase(): boolean {
  if (window.firebaseFirestore) return true
  try {
    app = firebase.initializeApp(firebaseConfig)
    const db = app.firestore()
    window.firebaseFirestore = db
    console.info('[firebase] Initialized with project:', firebaseConfig.projectId)
    window.dispatchEvent(
      new CustomEvent('firebase-ready', { detail: { ok: true } }),
    )
    return true
  } catch (e: any) {
    if (e?.code === 'app/no-export') return true
    console.error('[firebase] Initialization failed:', e)
    return false
  }
}

export async function waitForFirebase(timeoutMs = 5_000): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (window.firebaseFirestore) return true

  if (initFirebase()) return true

  // Fallback: poll briefly in case of async edge cases
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100))
    if (initFirebase()) return true
  }

  console.warn('[firebase] Timed out after', timeoutMs, 'ms')
  return false
}

export function getFirestore(): any | null {
  return window.firebaseFirestore ?? null
}

export function isFirebaseReady(): boolean {
  return !!window.firebaseFirestore
}
