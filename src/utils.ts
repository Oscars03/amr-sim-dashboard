/**
 * Clamps a number between a minimum and maximum value.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error('min cannot be greater than max')
  }
  return Math.min(Math.max(value, min), max)
}

/**
 * Formats a number of bytes into a human-readable string.
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes < 0) return '0 Bytes'
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const index = Math.min(i, sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`
}

/**
 * Truncates a string to a given length and appends an ellipsis.
 */
export function truncateString(str: string, maxLength: number): string {
  if (!str) return ''
  if (maxLength <= 0) return ''
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}

/**
 * Deep clones a plain object or array.
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T
  }
  const copy = {} as Record<string, any>
  for (const key of Object.keys(obj)) {
    copy[key] = deepClone((obj as Record<string, any>)[key])
  }
  return copy as T
}

/**
 * Debounces a function execution.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}
