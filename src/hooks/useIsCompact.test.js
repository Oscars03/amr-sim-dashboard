import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useIsCompact from './useIsCompact'

function setWindowWidth(width) {
  window.innerWidth = width
}

describe('useIsCompact', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports compact when the initial width is below the breakpoint', () => {
    setWindowWidth(400)
    const { result } = renderHook(() => useIsCompact(768))
    expect(result.current).toBe(true)
  })

  it('reports not compact when the initial width is at or above the breakpoint', () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useIsCompact(768))
    expect(result.current).toBe(false)
  })

  it('debounces resize events and updates after 150ms', () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useIsCompact(768))
    expect(result.current).toBe(false)

    act(() => {
      setWindowWidth(400)
      window.dispatchEvent(new Event('resize'))
    })
    // Not yet updated before the debounce delay elapses
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe(true)
  })

  it('coalesces rapid resize events into a single update', () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useIsCompact(768))

    act(() => {
      setWindowWidth(500)
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(100)
      setWindowWidth(400)
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(result.current).toBe(true)
  })
})
