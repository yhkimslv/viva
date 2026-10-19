// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloneProjectDialog } from '../components/CloneProjectDialog/CloneProjectDialog'
import { CloneProjectState } from '../hooks/useCloneProject'

afterEach(cleanup)
function props(): CloneProjectState {
  return {
    isOpen: true, language: 'en', repositoryUrl: 'https://github.com/team/demo', directoryName: 'demo',
    parentPath: '/projects', loading: false, cancelling: false, progress: null, error: null, recoveryPath: null, recoveryHint: null,
    open: vi.fn(), close: vi.fn(), setRepositoryUrl: vi.fn(), setDirectoryName: vi.fn(), chooseParent: vi.fn(), submit: vi.fn(), cancel: vi.fn()
  }
}
describe('CloneProjectDialog', () => {
  it('collects a GitHub URL and a new destination with useful authentication context', () => {
    const p = props()
    render(<CloneProjectDialog {...p} />)
    expect(screen.getByRole('dialog', { name: 'Clone a GitHub project' })).toBeTruthy()
    expect(screen.getByText(/Public repositories need no login/)).toBeTruthy()
    expect(screen.getByText('/projects/demo')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('GitHub repository HTTPS URL'), { target: { value: 'https://github.com/team/other' } })
    expect(p.setRepositoryUrl).toHaveBeenCalledWith('https://github.com/team/other')
    fireEvent.click(screen.getByRole('button', { name: 'Clone and open' }))
    expect(p.submit).toHaveBeenCalledOnce()
  })
  it('shows progress and allows cancellation while preventing duplicate submits', () => {
    const p = props()
    render(<CloneProjectDialog {...p} loading progress={{ jobId: 'job-1234', phase: 'receiving', percent: 40 }} />)
    expect(screen.getByRole('status').textContent).toContain('Receiving project · 40%')
    expect((screen.getByRole('button', { name: 'Clone and open' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.cancel).toHaveBeenCalledOnce()
  })
  it('shows a failed clone error and recovery path in Korean', () => {
    render(<CloneProjectDialog {...props()} language="ko" error="등록하지 못했습니다." recoveryPath="/projects/demo" />)
    expect(screen.getByRole('dialog', { name: 'GitHub 프로젝트 가져오기' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('/projects/demo')
    expect(screen.getByRole('alert').textContent).toContain('등록하지 못했습니다.')
  })
})
