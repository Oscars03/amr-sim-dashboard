import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Slider from './Slider'

describe('Slider', () => {
  it('renders the label and formatted value', () => {
    render(<Slider label="Speed" value={2.5} min={0} max={10} step={0.5} onChange={() => {}} />)
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByText('2.50')).toBeInTheDocument()
  })

  it('computes the fill percentage from value/min/max', () => {
    render(<Slider label="Speed" value={5} min={0} max={10} step={1} onChange={() => {}} />)
    const input = screen.getByRole('slider')
    expect(input.style.background).toContain('50%')
  })

  it('calls onChange with a parsed float when moved', () => {
    const onChange = vi.fn()
    render(<Slider label="Speed" value={5} min={0} max={10} step={1} onChange={onChange} />)
    const input = screen.getByRole('slider')
    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('produces a NaN fill percentage when max equals min (bug regression)', () => {
    // percent = ((value - min) / (max - min)) * 100 divides by zero here.
    // This test documents/pins the current buggy behavior; if Slider is
    // fixed to guard against max === min, update this expectation.
    render(<Slider label="Speed" value={5} min={5} max={5} step={1} onChange={() => {}} />)
    const input = screen.getByRole('slider')
    expect(input.style.background).toContain('NaN%')
  })
})
