import { describe, it, expect, vi } from 'vitest'
import { clamp, formatBytes, truncateString, deepClone, debounce } from './utils'

describe('clamp', () => {
  it('clamps values within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('throws an error if min is greater than max', () => {
    expect(() => clamp(5, 10, 0)).toThrow('min cannot be greater than max')
  })
})

describe('formatBytes', () => {
  it('formats zero and negative bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 Bytes')
    expect(formatBytes(-100)).toBe('0 Bytes')
  })

  it('formats bytes, KB, MB, GB, TB correctly', () => {
    expect(formatBytes(500)).toBe('500 Bytes')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1048576)).toBe('1 MB')
    expect(formatBytes(1073741824)).toBe('1 GB')
    expect(formatBytes(1099511627776)).toBe('1 TB')
    expect(formatBytes(1099511627776 * 1024)).toBe('1024 TB')
  })

  it('handles negative decimals parameter', () => {
    expect(formatBytes(1024, -1)).toBe('1 KB')
  })

  it('handles custom decimals', () => {
    expect(formatBytes(1500, 3)).toBe('1.465 KB')
  })
})

describe('truncateString', () => {
  it('returns empty string for empty input or non-positive maxLength', () => {
    expect(truncateString('', 5)).toBe('')
    expect(truncateString('hello', 0)).toBe('')
    expect(truncateString('hello', -1)).toBe('')
  })

  it('returns original string if length is less than or equal to maxLength', () => {
    expect(truncateString('hello', 5)).toBe('hello')
    expect(truncateString('hi', 5)).toBe('hi')
  })

  it('truncates string and adds ellipsis if longer than maxLength', () => {
    expect(truncateString('hello world', 5)).toBe('hello...')
  })
})

describe('deepClone', () => {
  it('returns primitive values and null as-is', () => {
    expect(deepClone(null)).toBeNull()
    expect(deepClone(42)).toBe(42)
    expect(deepClone('test')).toBe('test')
    expect(deepClone(true)).toBe(true)
  })

  it('clones Date objects', () => {
    const date = new Date('2026-01-01')
    const clonedDate = deepClone(date)
    expect(clonedDate).toEqual(date)
    expect(clonedDate).not.toBe(date)
  })

  it('clones arrays', () => {
    const arr = [1, { a: 2 }, [3]]
    const clonedArr = deepClone(arr)
    expect(clonedArr).toEqual(arr)
    expect(clonedArr).not.toBe(arr)
    expect(clonedArr[1]).not.toBe(arr[1])
  })

  it('clones nested objects', () => {
    const obj = { a: 1, b: { c: 2 } }
    const clonedObj = deepClone(obj)
    expect(clonedObj).toEqual(obj)
    expect(clonedObj).not.toBe(obj)
    expect(clonedObj.b).not.toBe(obj.b)
  })
})

describe('debounce', () => {
  it('delays function execution and clears pending timers on repeated calls', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debouncedFn = debounce(fn, 100)

    debouncedFn('first')
    expect(fn).not.toHaveBeenCalled()

    debouncedFn('second')
    vi.advanceTimersByTime(50)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith('second')

    vi.useRealTimers()
  })
})
