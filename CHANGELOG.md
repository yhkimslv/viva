# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.3.0-beta.1] — 2026-10-19

### Added
- macOS Apple Silicon/Intel DMGs and Windows x64 installer for the team preview
- Graphical Git installation guidance and project-local commit author settings
- Native installation/startup gates and complete-release upload with SHA-256 checksums
- In-app GitHub HTTPS clone with progress, cancellation, exclusive destination writes, and recovery guidance
- Read-only lead dashboard for PRs, review requests, CI, assigned team issues, and workflow runs
- Ubuntu and Windows CI with an audit gate covering all dependencies

### Fixed
- Repeat team uploads, stale branch/repository targets, authenticated update previews, and concurrent Git operations
- Default branch protection and deletion safety for unmerged local or teammate work
- Merge completion after conflict resolution, manual staging, and retryable operation errors
- Project isolation for file status and update previews; Git metadata and dotfile change notifications
- Project AI consent enforcement and GitHub login cancellation
- GitHub credentials no longer stored in upstream URLs and redacted from Git errors
- Actual source typechecking and production build validation in CI

### Changed
- Updated Electron, the build/test toolchain, file watcher, settings store, and UUID dependencies; npm audit reports zero vulnerabilities
- ESM main/CJS preload output, packaged-app runtime verification, and syntax checks on build output
- Updated simple-git to 4.0.2 with scoped authentication and explicit safe environment configuration
- Added a team workflow guide, readiness review, and PR template

## [0.1.0] — 2025-05-08

### Added
- Local-first project linking with `git init` gating and pre-save file warnings
- Save Progress workflow: stage, write or generate a commit message, commit locally
- Full file visibility panel: tracked, modified, staged, untracked, and clean files in one view
- Dependency hiding: `node_modules` and generated folders collapsed by default, expandable with Show deps
- Branch management: create, switch, merge, and delete local branches with default-branch guardrails
- GitHub upload with two modes — private backup repository and team collaboration branch
- Pull update preview: inspect incoming commits and changed files before pulling
- Auto Save Message: AI-generated commit message from staged diff with 3–5 s timeout fallback
- Natural Language Undo: find and preview a restore point using plain-language queries
- Untracked File Review: two-tier classification (rule-based fast pass + AI for ambiguous files)
- File Insight: read-only AI explanation of a selected file's purpose and related context
- Smart Conflict Resolver: guided file-by-file merge dialog without exposing raw conflict markers
- Weekly Report: Git statistics + AI commit summaries compiled into a readable narrative
- Language selector: English and 한국어
- Terminology mode: Newbie (Save Progress / Version / Upload) and Pro (Commit / Branch / Push)
- OpenAI and Anthropic provider support; keys stored with Electron safeStorage
- GitHub device login and Personal Access Token support; tokens stored with Electron safeStorage
- Safety rules enforced throughout: no silent git init, no force push, no auto conflict resolution, no AI diff without project consent
