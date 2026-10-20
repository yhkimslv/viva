// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitNotInstalled } from '../components/GitNotInstalled/GitNotInstalled'

const mocks = vi.hoisted(() => ({
  language: 'en' as 'en' | 'ko',
  invokeDb: vi.fn()
}))

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { language: mocks.language } })
}))
vi.mock('../ipc', () => ({ invokeDb: mocks.invokeDb }))

beforeEach(() => {
  mocks.language = 'en'
  mocks.invokeDb.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('Git installation guidance', () => {
  it('opens only the official GUI installer pages on request and keeps retry available', () => {
    const onRetry = vi.fn()
    render(<GitNotInstalled onRetry={onRetry} />)
    expect(mocks.invokeDb).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open Git for Windows' }))
    expect(mocks.invokeDb).toHaveBeenLastCalledWith('shell:openExternal', 'https://gitforwindows.org/')
    fireEvent.click(screen.getByRole('button', { name: 'Open Apple Additional tools' }))
    expect(mocks.invokeDb).toHaveBeenLastCalledWith(
      'shell:openExternal',
      'https://developer.apple.com/xcode/resources/'
    )
    expect(screen.getByText(/You do not need Node.js or npm/)).toBeTruthy()
    expect(screen.getByText(/Quit and reopen VIVA/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check for Git again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows Korean graphical setup instructions and a usable fallback if opening the browser fails', async () => {
    mocks.language = 'ko'
    mocks.invokeDb.mockRejectedValue(new Error('browser unavailable'))
    const onRetry = vi.fn()
    render(<GitNotInstalled onRetry={onRetry} />)

    expect(screen.getByRole('heading', { name: 'Git을 설치하고 시작하세요' })).toBeTruthy()
    expect(screen.getByText(/유료 개발자 멤버십은 필요하지 않습니다/)).toBeTruthy()
    expect(screen.getByText(/터미널 명령어를 입력할 필요가 없습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apple Additional tools 열기' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'https://developer.apple.com/xcode/resources/'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Git 설치 다시 확인' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
