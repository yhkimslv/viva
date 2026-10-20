// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitIdentity } from '../../../shared/gitIdentity'
import { GitIdentitySettings } from '../components/GitIdentitySettings/GitIdentitySettings'
import { invokeGit } from '../ipc'

vi.mock('../ipc', () => ({ invokeGit: vi.fn() }))
const inherited: GitIdentity = { name: { value: 'Existing Person', scope: 'global' }, email: { value: 'global@example.test', scope: 'global' } }
const local: GitIdentity = { name: { value: 'New Author', scope: 'local' }, email: { value: 'new@example.test', scope: 'local' } }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(invokeGit).mockResolvedValue(inherited) })
afterEach(cleanup)

describe('GitIdentitySettings', () => {
  it('shows inherited configuration without saving until the user explicitly chooses project settings', async () => {
    render(<GitIdentitySettings projectId="project-one" language="ko" />)
    await screen.findByDisplayValue('Existing Person')
    expect(screen.getAllByText('컴퓨터에서 상속한 설정')).toHaveLength(2)
    expect(screen.getByText(/업로드하면 저장소를 볼 수 있는 사람에게 표시/)).toBeTruthy()
    expect(invokeGit).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('작성자 이름'), { target: { value: 'New Author' } })
    fireEvent.change(screen.getByLabelText('작성자 이메일'), { target: { value: 'new@example.test' } })
    vi.mocked(invokeGit).mockResolvedValueOnce(local)
    fireEvent.click(screen.getByRole('button', { name: '이 프로젝트에 저장' }))
    await screen.findByRole('status')
    expect(invokeGit).toHaveBeenCalledWith('git:identity:set', 'project-one', { name: 'New Author', email: 'new@example.test' })
    expect(screen.getAllByText('이 프로젝트 설정')).toHaveLength(2)
  })
  it('validates inputs before saving and allows recovery after a save error', async () => {
    render(<GitIdentitySettings projectId="project-one" />)
    await screen.findByDisplayValue('Existing Person')
    fireEvent.change(screen.getByLabelText('Author email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save for this project' }))
    expect(screen.getByRole('alert').textContent).toContain('email address')
    expect(invokeGit).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Author email'), { target: { value: 'valid@example.test' } })
    vi.mocked(invokeGit).mockRejectedValueOnce(new Error('config lock'))
    fireEvent.click(screen.getByRole('button', { name: 'Save for this project' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Reload the current settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }))
    await screen.findByDisplayValue('global@example.test')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('ignores stale project responses after switching projects', async () => {
    let resolveFirst!: (identity: GitIdentity) => void
    vi.mocked(invokeGit).mockImplementation((_channel, project) => project === 'first'
      ? new Promise<GitIdentity>((resolve) => { resolveFirst = resolve }) : Promise.resolve(local))
    const { rerender } = render(<GitIdentitySettings projectId="first" />)
    rerender(<GitIdentitySettings projectId="second" />)
    await screen.findByDisplayValue('New Author')
    await act(async () => { resolveFirst(inherited) })
    expect(screen.queryByDisplayValue('Existing Person')).toBeNull()
    expect(screen.getByDisplayValue('New Author')).toBeTruthy()
  })
  it('offers a reload after initial inspection fails', async () => {
    vi.mocked(invokeGit).mockRejectedValueOnce(new Error('missing project'))
    render(<GitIdentitySettings projectId="project-one" />)
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: 'Save for this project' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }))
    await screen.findByDisplayValue('Existing Person')
  })
})
