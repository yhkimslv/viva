// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictResolver } from '../components/ConflictResolver/ConflictResolver'
import { FileStatus } from '../types'

vi.mock('../hooks/useTerms', () => ({
  useTerms: () => ({
    conflictResolverTitle: 'Resolve Conflicts',
    conflictResolverDesc: 'Choose which version to keep for each file.',
    conflictChoiceHelp: 'Each choice replaces the entire file.',
    conflictOperationFailed: 'Could not finish this step. Please try again.',
    closeConflictResolverLabel: 'Close conflict resolver',
    conflictCommitMessageLabel: 'Merge commit message',
    keepMineBtn: 'Keep Mine',
    keepTheirsBtn: 'Keep Theirs',
    resolvedLabel: 'Resolved',
    abortMergeBtn: 'Abort merge',
    completeMergeBtn: 'Complete merge',
    conflictMergeCommitMessage: 'Merge branch',
    conflictAiHintBtn: 'AI hint',
    conflictAiHinting: 'Analyzing…',
    conflictAiSuggestBtn: 'Suggest message',
    conflictAiSuggesting: 'Suggesting…',
    gitErrorMessage: (_code: string, fallback: string) => fallback
  })
}))

function makeFile(path: string): FileStatus {
  return { path, status: 'conflicted', staged: false }
}

const twoFiles = [makeFile('src/alpha.ts'), makeFile('src/beta.ts')]

function renderResolver(
  files: FileStatus[] = twoFiles,
  overrides: Partial<Omit<ComponentProps<typeof ConflictResolver>, 'conflictedFiles'>> = {}
) {
  const props = {
    conflictedFiles: files,
    onResolve: vi.fn().mockResolvedValue(undefined),
    onAbort: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides
  }
  const view = render(<ConflictResolver {...props} />)
  return {
    ...props,
    rerender: (files: FileStatus[]) => view.rerender(<ConflictResolver {...props} conflictedFiles={files} />),
    unmount: view.unmount
  }
}

describe('ConflictResolver', () => {
  afterEach(cleanup)

  // AC 7: title and description rendered
  it('renders title and description', () => {
    renderResolver()
    expect(screen.getByText('Resolve Conflicts')).toBeTruthy()
    expect(screen.getByText(/Choose which version to keep/i)).toBeTruthy()
  })

  // AC 8: one row per file
  it('renders a row for each conflicted file', () => {
    renderResolver()
    expect(screen.getByText('src/alpha.ts')).toBeTruthy()
    expect(screen.getByText('src/beta.ts')).toBeTruthy()
  })

  // AC 9: Keep Mine / Keep Theirs buttons shown per file
  it('shows Keep Mine and Keep Theirs for each unresolved file', () => {
    renderResolver()
    expect(screen.getAllByRole('button', { name: 'Keep Mine' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Keep Theirs' })).toHaveLength(2)
  })

  // AC 10: clicking Keep Mine calls onResolve with 'ours'
  it('calls onResolve with ours when Keep Mine is clicked', async () => {
    const { onResolve } = renderResolver()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('src/alpha.ts', 'ours'))
  })

  // AC 11: clicking Keep Theirs calls onResolve with 'theirs'
  it('calls onResolve with theirs when Keep Theirs is clicked', async () => {
    const { onResolve } = renderResolver()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Theirs' })[0])
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('src/alpha.ts', 'theirs'))
  })

  // AC 12: resolved file shows badge instead of buttons
  it('shows Resolved badge after a file is resolved', async () => {
    renderResolver()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    // buttons for resolved file are gone; only one set remains for beta.ts
    expect(screen.getAllByRole('button', { name: 'Keep Mine' })).toHaveLength(1)
  })

  // AC 14 + AC 15: complete area and Complete merge button appear only when all resolved
  it('shows the complete area only after all files are resolved', async () => {
    renderResolver()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()

    // resolve first file
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(screen.getAllByText('Resolved')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()

    // resolve second file
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(screen.getAllByText('Resolved')).toHaveLength(2))

    expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy()
  })

  // AC 16: Complete merge disabled when message is empty
  it('disables Complete merge when the commit message is empty', async () => {
    renderResolver([makeFile('src/only.ts')])
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })

    expect((screen.getByRole('button', { name: 'Complete merge' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // AC 15: clicking Complete merge calls onComplete with trimmed message
  it('calls onComplete with the commit message when Complete merge is clicked', async () => {
    const { onComplete } = renderResolver([makeFile('src/only.ts')])
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Merge feature branch  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete merge' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('Merge feature branch'))
  })

  // AC 17: Enter key in commit input triggers completion
  it('submits on Enter key in the commit message input', async () => {
    const { onComplete } = renderResolver([makeFile('src/only.ts')])
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Merge branch' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('Merge branch'))
  })

  // AC 18: Abort merge always visible and calls onAbort
  it('always shows Abort merge and calls onAbort when clicked', async () => {
    const { onAbort, onClose } = renderResolver()
    expect(screen.getByRole('button', { name: 'Abort merge' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    await waitFor(() => expect(onAbort).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  // AC 19: close button calls onClose
  it('calls onClose when the × button is clicked', () => {
    const { onClose } = renderResolver()
    fireEvent.click(screen.getByRole('button', { name: 'Close conflict resolver' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps resolved rows and merge completion when status refreshes remove conflicts', async () => {
    const { rerender } = renderResolver()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(screen.getAllByText('Resolved')).toHaveLength(1))

    rerender([twoFiles[1]])
    expect(screen.getByText('src/alpha.ts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Theirs' }))
    await waitFor(() => expect(screen.getAllByText('Resolved')).toHaveLength(2))

    rerender([])
    expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Merge commit message' })).toBeTruthy()
  })

  it('requires newly reported conflicts to be resolved even after an earlier file was resolved', async () => {
    const { rerender } = renderResolver([twoFiles[0]])
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy())

    rerender([twoFiles[1]])
    expect(screen.getByText('src/beta.ts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep Mine' })).toBeTruthy()
  })

  it('clears a previous resolution if the same file becomes conflicted again', async () => {
    const { rerender } = renderResolver([twoFiles[0]])
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    rerender([])
    rerender([twoFiles[0]])

    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep Mine' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
  })

  it('allows completion when all conflicts are resolved manually and staged externally', () => {
    const { rerender } = renderResolver()
    rerender([])

    expect(screen.getAllByText('Resolved')).toHaveLength(2)
    expect(screen.getByText('src/alpha.ts')).toBeTruthy()
    expect(screen.getByText('src/beta.ts')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy()
  })

  it('allows mixing a selected version with an externally resolved last conflict', async () => {
    const { rerender } = renderResolver()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    rerender([twoFiles[1]])
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
    rerender([])

    expect(screen.getAllByText('Resolved')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy()
  })

  it('retains newly reported files when those conflicts are later resolved externally', () => {
    const { rerender } = renderResolver([twoFiles[0]])
    rerender(twoFiles)
    rerender([])

    expect(screen.getAllByText('Resolved')).toHaveLength(2)
    expect(screen.getByText('src/beta.ts')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete merge' })).toBeTruthy()
  })

  it('reopens a manually resolved file if Git reports the conflict again', () => {
    const { rerender } = renderResolver([twoFiles[0]])
    rerender([])
    expect(screen.getByText('Resolved')).toBeTruthy()
    rerender([twoFiles[0]])

    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep Mine' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
  })

  it('does not let a pending resolution hide a newer conflict for the same path', async () => {
    let finish!: () => void
    const onResolve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { rerender } = renderResolver([twoFiles[0]], { onResolve })
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    rerender([])
    rerender([twoFiles[0]])
    finish()

    await waitFor(() => expect((screen.getByRole('button', { name: 'Keep Mine' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
  })

  it('does not offer merge completion when mounted without a conflict session', () => {
    renderResolver([])

    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete merge' })).toBeNull()
  })

  it('keeps a failed resolution unresolved and lets the user retry', async () => {
    const onResolve = vi.fn()
      .mockRejectedValueOnce({ code: 'UNKNOWN', message: 'The file could not be staged.' })
      .mockResolvedValueOnce(undefined)
    const { onClose } = renderResolver([twoFiles[0]], { onResolve })
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be staged'))
    expect(screen.queryByText('Resolved')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep Theirs' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('prevents another resolution, abort, or close while Git is changing a file', async () => {
    let finish!: () => void
    const onResolve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { onAbort, onClose } = renderResolver(twoFiles, { onResolve })
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Mine' })[0])

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep Theirs' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onAbort).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    finish()
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Abort merge' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['false', 'reject'])('does not close when merge completion fails (%s)', async (failure) => {
    const onComplete = failure === 'false'
      ? vi.fn().mockResolvedValue(false)
      : vi.fn().mockRejectedValue(new Error('Commit hook failed.'))
    const { onClose } = renderResolver([twoFiles[0]], { onComplete })
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Complete merge' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Complete merge' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits only once when Enter is repeated while completing a merge', async () => {
    let finish!: () => void
    const onComplete = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { onAbort, onClose } = renderResolver([twoFiles[0]], { onComplete })
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onAbort).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('keeps a failed abort open with an actionable error', async () => {
    const { onClose } = renderResolver(twoFiles, {
      onAbort: vi.fn().mockRejectedValue(new Error('Cannot abort while files are locked.'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('files are locked'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close a new project dialog when a previous dialog finishes after unmount', async () => {
    let finish!: () => void
    const onAbort = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { onClose, unmount } = renderResolver(twoFiles, { onAbort })
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    unmount()
    finish()
    await onAbort.mock.results[0].value
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports AI failures without losing resolution actions', async () => {
    renderResolver([twoFiles[0]], {
      aiEnabled: true,
      onAnalyzeFile: vi.fn().mockRejectedValue(new Error('AI is unavailable.'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI hint' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('AI is unavailable'))
    expect((screen.getByRole('button', { name: 'Keep Mine' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('Resolved')).toBeNull()
  })

  it('names the dialog, explains whole-file choices, and keeps keyboard focus inside it', () => {
    const { onClose } = renderResolver()
    const dialog = screen.getByRole('dialog', { name: 'Resolve Conflicts' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Each choice replaces the entire file.')).toBeTruthy()
    const close = screen.getByRole('button', { name: 'Close conflict resolver' })
    const abort = screen.getByRole('button', { name: 'Abort merge' })

    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(abort)
    fireEvent.keyDown(abort, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
