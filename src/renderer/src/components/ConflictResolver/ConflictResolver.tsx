import { useEffect, useId, useRef, useState } from 'react'
import { FileStatus } from '../../types'
import { useTerms } from '../../hooks/useTerms'
import styles from './ConflictResolver.module.css'

interface ConflictHint {
  hint: string
  recommendation: 'ours' | 'theirs' | 'either'
}

interface Props {
  conflictedFiles: FileStatus[]
  aiEnabled?: boolean
  onResolve: (filePath: string, strategy: 'ours' | 'theirs') => Promise<void>
  onAbort: () => Promise<void>
  onComplete: (message: string) => Promise<void | boolean>
  onClose: () => void
  onSuggestMessage?: () => Promise<{ message: string }>
  onAnalyzeFile?: (filePath: string) => Promise<ConflictHint>
}

export function ConflictResolver({
  conflictedFiles,
  aiEnabled,
  onResolve,
  onAbort,
  onComplete,
  onClose,
  onSuggestMessage,
  onAnalyzeFile
}: Props): JSX.Element {
  const t = useTerms()
  const [knownFiles, setKnownFiles] = useState(() => new Map(conflictedFiles.map((file) => [file.path, file])))
  const [resolved, setResolved] = useState<Map<string, FileStatus>>(new Map())
  const previousConflictsRef = useRef(new Set(conflictedFiles.map((file) => file.path)))
  const conflictGenerationRef = useRef(new Map(conflictedFiles.map((file) => [file.path, 0])))
  const [operation, setOperation] = useState<{ kind: string; path?: string } | null>(null)
  const operationRef = useRef(false)
  const mountedRef = useRef(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [error, setError] = useState<string | null>(null)
  const [hints, setHints] = useState<Record<string, ConflictHint>>({})
  const [commitMessage, setCommitMessage] = useState(t.conflictMergeCommitMessage)

  // A file can also be resolved in an editor and staged outside this dialog. Keep
  // every conflict seen in this session and trust its disappearance from Git status.
  const files = new Map(knownFiles)
  conflictedFiles.forEach((file) => files.set(file.path, file))
  const conflictPaths = new Set(conflictedFiles.map((file) => file.path))
  const isResolvedPath = (path: string): boolean => !conflictPaths.has(path) || resolved.has(path)
  const allResolved = files.size > 0 && [...files.keys()].every(isResolvedPath)
  const showAi = aiEnabled && Boolean(onSuggestMessage || onAnalyzeFile)

  useEffect(() => {
    setKnownFiles((previous) => {
      const additions = conflictedFiles.filter((file) => !previous.has(file.path))
      return additions.length > 0
        ? new Map([...previous, ...additions.map((file): [string, FileStatus] => [file.path, file])])
        : previous
    })
    const currentPaths = new Set(conflictedFiles.map((file) => file.path))
    const reintroduced = conflictedFiles
      .filter((file) => !previousConflictsRef.current.has(file.path))
      .map((file) => file.path)
    previousConflictsRef.current = currentPaths
    if (reintroduced.length === 0) return
    reintroduced.forEach((path) => {
      conflictGenerationRef.current.set(path, (conflictGenerationRef.current.get(path) ?? 0) + 1)
    })
    setResolved((previous) => {
      if (!reintroduced.some((path) => previous.has(path))) return previous
      const next = new Map(previous)
      reintroduced.forEach((path) => next.delete(path))
      return next
    })
    setHints((previous) => {
      if (!reintroduced.some((path) => path in previous)) return previous
      const next = { ...previous }
      reintroduced.forEach((path) => delete next[path])
      return next
    })
  }, [conflictedFiles])

  useEffect(() => {
    mountedRef.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => {
      mountedRef.current = false
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  const runOperation = async (
    nextOperation: { kind: string; path?: string },
    action: () => Promise<void>
  ): Promise<void> => {
    // A ref also guards repeated Enter/click events before React re-renders.
    if (operationRef.current) return
    operationRef.current = true
    setOperation(nextOperation)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (!mountedRef.current) return
      const failure = caught as { code?: string; message?: string } | null
      setError(
        typeof failure?.message === 'string' && failure.message.trim()
          ? t.gitErrorMessage(failure.code ?? 'UNKNOWN', failure.message)
          : t.conflictOperationFailed
      )
    } finally {
      operationRef.current = false
      if (mountedRef.current) setOperation(null)
    }
  }

  const handleResolve = (file: FileStatus, strategy: 'ours' | 'theirs'): Promise<void> => {
    const generation = conflictGenerationRef.current.get(file.path)
    return runOperation({ kind: 'resolve', path: file.path }, async () => {
      await onResolve(file.path, strategy)
      if (mountedRef.current && conflictGenerationRef.current.get(file.path) === generation) {
        setResolved((prev) => new Map(prev).set(file.path, file))
      }
    })
  }

  const handleAbort = (): Promise<void> =>
    runOperation({ kind: 'abort' }, async () => {
      await onAbort()
      if (mountedRef.current) onClose()
    })

  const handleComplete = async (): Promise<void> => {
    if (!allResolved || !commitMessage.trim()) return
    await runOperation({ kind: 'complete' }, async () => {
      const completed = await onComplete(commitMessage.trim())
      if (!mountedRef.current) return
      if (completed === false) {
        setError(t.conflictOperationFailed)
        return
      }
      onClose()
    })
  }

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={Boolean(operation)}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !operationRef.current) onClose()
          if (event.key !== 'Tab') return
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)'
          )
          if (!focusable?.length) {
            event.preventDefault()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className={styles.header}>
          <div>
            <div className={styles.title} id={titleId}>{t.conflictResolverTitle}</div>
            <div className={styles.desc} id={descriptionId}>
              {t.conflictResolverDesc}
              <p>{t.conflictChoiceHelp}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} disabled={Boolean(operation)} aria-label={t.closeConflictResolverLabel}>×</button>
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.fileList}>
          {[...files.values()].map((file) => {
            const isResolved = isResolvedPath(file.path)
            const isAnalyzing = operation?.kind === 'analyze' && operation.path === file.path
            const hint = hints[file.path]
            return (
              <div key={file.path} role="group" aria-label={file.path} className={`${styles.fileRow} ${isResolved ? styles.fileRowResolved : ''}`}>
                <div className={styles.fileRowMain}>
                  <span className={styles.filePath} title={file.path}>{file.path}</span>
                  {isResolved ? (
                    <span className={styles.resolvedBadge}>{t.resolvedLabel}</span>
                  ) : (
                    <div className={styles.fileActions}>
                      {showAi && onAnalyzeFile && (
                        <button
                          className={styles.hintBtn}
                          onClick={() => void runOperation({ kind: 'analyze', path: file.path }, async () => {
                            const hint = await onAnalyzeFile(file.path)
                            if (mountedRef.current) setHints((prev) => ({ ...prev, [file.path]: hint }))
                          })}
                          disabled={Boolean(operation)}
                        >
                          {isAnalyzing ? t.conflictAiHinting : t.conflictAiHintBtn}
                        </button>
                      )}
                      <button
                        className={styles.keepBtn}
                        onClick={() => void handleResolve(file, 'ours')}
                        disabled={Boolean(operation)}
                      >
                        {t.keepMineBtn}
                      </button>
                      <button
                        className={styles.keepBtn}
                        onClick={() => void handleResolve(file, 'theirs')}
                        disabled={Boolean(operation)}
                      >
                        {t.keepTheirsBtn}
                      </button>
                    </div>
                  )}
                </div>
                {hint && !isResolved && (
                  <div className={`${styles.hintRow} ${hint.recommendation !== 'either' ? styles.hintRowColored : ''}`}>
                    <span className={styles.hintText}>{hint.hint}</span>
                    {hint.recommendation === 'ours' && (
                      <span className={styles.hintRec}>{t.conflictAiRecommendOurs}</span>
                    )}
                    {hint.recommendation === 'theirs' && (
                      <span className={styles.hintRec}>{t.conflictAiRecommendTheirs}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {allResolved && (
          <div className={styles.completeArea}>
            <input
              className={styles.commitInput}
              aria-label={t.conflictCommitMessageLabel}
              value={commitMessage}
              disabled={Boolean(operation)}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleComplete() }}
            />
            {showAi && onSuggestMessage && (
              <button
                className={styles.suggestBtn}
                onClick={() => void runOperation({ kind: 'suggest' }, async () => {
                  const result = await onSuggestMessage()
                  if (mountedRef.current) setCommitMessage(result.message)
                })}
                disabled={Boolean(operation)}
              >
                {operation?.kind === 'suggest' ? t.conflictAiSuggesting : t.conflictAiSuggestBtn}
              </button>
            )}
            <button
              className={styles.completeBtn}
              onClick={() => void handleComplete()}
              disabled={Boolean(operation) || !commitMessage.trim()}
            >
              {t.completeMergeBtn}
            </button>
          </div>
        )}

        <div className={styles.footer}>
          <button
            className={styles.abortBtn}
            onClick={() => void handleAbort()}
            disabled={Boolean(operation)}
          >
            {t.abortMergeBtn}
          </button>
        </div>
      </div>
    </div>
  )
}
