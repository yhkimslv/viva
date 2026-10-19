// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTerms } from '../i18n/terms'
import { AIConsentDialog } from '../components/AIConsentDialog/AIConsentDialog'

const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'ko' }))

vi.mock('../hooks/useTerms', () => ({
  useTerms: () => getTerms(locale.language, 'newbie')
}))

afterEach(cleanup)

describe('AIConsentDialog', () => {
  it.each(['en', 'ko'] as const)('explains the actual AI sharing scope in %s', (language) => {
    locale.language = language
    const terms = getTerms(language, 'newbie')
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(<AIConsentDialog onAccept={onAccept} onDecline={onDecline} />)

    expect(screen.getByRole('dialog', { name: terms.aiConsentTitle })).toBeTruthy()
    expect(screen.getByText(terms.aiDataSharingDescription)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: terms.aiConsentDecline }))
    expect(onDecline).toHaveBeenCalledOnce()
    expect(onAccept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: terms.aiConsentAccept }))
    expect(onAccept).toHaveBeenCalledOnce()
  })
})
