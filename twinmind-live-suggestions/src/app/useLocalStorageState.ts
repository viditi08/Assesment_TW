import { useEffect, useState } from 'react'

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
  /** Merge saved JSON with defaults so new settings keys appear after upgrades. */
  merge?: (parsed: unknown, initial: T) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return initialValue
      const parsed: unknown = JSON.parse(raw)
      return merge ? merge(parsed, initialValue) : (parsed as T)
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore storage failures (private mode, quota, etc)
    }
  }, [key, value])

  return [value, setValue] as const
}

