# VIVA installation and first project guide

For the **VIVA 0.3.0-beta.1 team preview**. Follow these six steps: install VIVA, install Git if needed, connect GitHub, clone your project, check your commit author, and open the dashboard. You do not need Node.js, npm, or terminal commands.

[한국어 안내](user-guide.ko.md) · [Download release](https://github.com/yhkimslv/viva/releases/tag/v0.3.0-beta.1)

Use your own GitHub account. Ask your project lead for the **team repository HTTPS URL** and accept any repository invitation before starting. Being signed in does not itself give you access to a private team repository.

## 1 Install VIVA

Download the installer for your computer from the release’s **Assets**. Choose an installer below, rather than the source code ZIP.

| Your computer | Download |
| --- | --- |
| Apple Silicon Mac, with an Apple M series chip | [VIVA-0.3.0-beta.1-mac-arm64.dmg](https://github.com/yhkimslv/viva/releases/download/v0.3.0-beta.1/VIVA-0.3.0-beta.1-mac-arm64.dmg) |
| Intel Mac | [VIVA-0.3.0-beta.1-mac-x64.dmg](https://github.com/yhkimslv/viva/releases/download/v0.3.0-beta.1/VIVA-0.3.0-beta.1-mac-x64.dmg) |
| Windows x64 PC | [VIVA-0.3.0-beta.1-windows-x64-setup.exe](https://github.com/yhkimslv/viva/releases/download/v0.3.0-beta.1/VIVA-0.3.0-beta.1-windows-x64-setup.exe) |

Mac requires **macOS 13 or later**. Use **Apple menu → About This Mac** to check your chip or processor. This preview does not include a Windows ARM installer. The release also provides `SHA256SUMS.txt` for checking downloaded files.

### macOS

1. Open the matching `.dmg` file.
2. Drag **VIVA** into **Applications**.
3. Open VIVA from Applications.

This preview is **ad-hoc signed, without Apple Developer ID signing or notarization**. If macOS blocks it because the developer cannot be verified, first confirm that you downloaded the intended team release. If you choose to trust it, Apple’s per-app process is **System Settings → Privacy & Security → Open Anyway**, followed by **Open**, after the first blocked launch. This is a decision about this app; do not turn off Gatekeeper. If the message says the app is damaged or will harm your computer, stop and contact your lead. [Apple’s official guidance](https://support.apple.com/en-us/102445)

### Windows

1. Open the `.exe` installer.
2. Follow the installation wizard and choose the installation folder if needed. It installs for your current user without requesting administrator elevation.
3. Open **VIVA** from the desktop shortcut or Start menu.

This preview has **no Windows publisher certificate**, so an unknown-publisher or SmartScreen warning may appear. Some SmartScreen prompts offer **More info → Run anyway**; use that only if you have checked and trust this release file. If Smart App Control or an organization policy blocks it, ask your lead or administrator for a supported, signed build. Do not disable antivirus, SmartScreen, or Smart App Control. [Microsoft’s SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [Smart App Control limitations](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

After Git is available, VIVA’s sidebar has **EN** and **KO** buttons for switching languages. This guide uses the English labels. GitHub login buttons remain in English in either language. **Newbie / Pro** changes terminology separately from the language.

## 2 Install Git if VIVA asks

Git is the separate tool VIVA uses to save project history. If it is already available, continue to step 3. Otherwise, VIVA shows **Install Git to get started** with download buttons and installation instructions.

- **Windows:** select **Open Git for Windows**, download the installer from [Git for Windows](https://gitforwindows.org/), and run the downloaded `.exe`. Keep the default options, including the option that makes Git available to other applications. Quit and reopen VIVA after installation.
- **macOS:** select **Open Apple Additional tools**. On [Apple’s Xcode Resources page](https://developer.apple.com/xcode/resources/), find **Additional tools → View downloads**, then sign in with your Apple Account. A paid developer membership is not required. Download **Command Line Tools for Xcode** compatible with your macOS version. Open its `.dmg` and run the `.pkg` installer inside.

Return to VIVA and select **Check for Git again**. If Git is still missing, quit VIVA completely and reopen it before checking again.

## 3 Connect your GitHub account

1. Select **Connect GitHub** in the sidebar, then **Login with GitHub**.
2. VIVA opens your browser and displays **Waiting for GitHub authorization** with a short code. Select **Copy** in VIVA.
3. In the browser, check that you are on **github.com** and signed in to your own account. Paste the code at [GitHub’s device login page](https://github.com/login/device). If the browser did not open, use VIVA’s **Can’t see the page? Open github.com/login/device →** link.
4. Check the application and permissions before approving. This release uses the OAuth app **Git Abstraction Tool**, owned by **Sean Lee (`98sean`)**. Its name is different from VIVA. It requests the broad **`repo`** permission, which includes read and write access to public and private repositories available to your account, not only the repository you plan to clone. See [GitHub’s scope explanation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). If the application details are unexpected, stop and confirm them with your lead.
5. Complete GitHub’s approval, then return to VIVA. Wait until the sidebar says **GitHub connected**.

Enter any GitHub password or two-factor code only on GitHub’s website. **You do not need to create a personal access token or enter a GitHub password in VIVA for this flow.** Do not share tokens, device codes, or another teammate’s account. Organization approval or SSO may also be required for a private repository; ask your lead or organization administrator if access is blocked.

## 4 Clone the team project

“Clone” means downloading a repository and its Git history into a new local folder.

1. In GitHub, open your team repository and select **Code → HTTPS**. Copy its repository URL, or use the HTTPS URL supplied by your lead.
2. In VIVA, select **Clone from GitHub**.
3. In **GitHub repository HTTPS URL**, paste the repository address. For example, `https://github.com/yhkimslv/viva.git` is a **public sample**; replace it with your actual team URL. Do not paste a specific file, branch page, SSH address, or URL containing a token.
4. Under **Save inside**, select **Choose folder** and choose the parent folder where the project should live.
5. Check **New project folder name**. VIVA suggests a name from the URL. Use a new name that does not already exist inside the selected parent folder. For example, parent `Documents/Projects` plus name `team-app` creates `Documents/Projects/team-app`.
6. Check **Destination**, then select **Clone and open**. Keep VIVA open while it receives the project and places its files in the new folder. Large repositories can take time.

Public repositories can be cloned without connecting GitHub. **Private repositories require the connected account to have access before you clone.** This version supports GitHub.com HTTPS repository addresses; SSH and GitHub Enterprise hosts are not supported by this dialog. Submodules are not downloaded automatically.

VIVA does not overwrite an existing destination folder. **Cancel** stops a running clone; wait for cancellation to finish before retrying. If cancellation or failure occurs while files are being placed into the destination, VIVA preserves the partial folder and displays its path. Review it before removing it, or retry with another new folder name. If the complete download succeeds but VIVA cannot register the project, follow its instruction to link the preserved folder as an existing project.

When cloning succeeds, the project appears in the sidebar and opens automatically.

If the repository is already on your computer, use **+ Add Repository / + Link a Project** instead and select its existing folder. The label depends on the terminology mode.

## 5 Check your commit author

Before making your first saved change:

1. Select the project and open **Project Settings**.
2. Find **Commit author**. Check **Author name** and **Author email**. Each field shows whether it comes from an **Inherited computer setting**, a **Project setting**, or is **Not configured**.
3. Enter the name and email you want recorded in this project’s commits. You may use your private commit email from [GitHub Settings → Emails](https://github.com/settings/emails).
4. Select **Save for this project** and wait for **Author settings saved for this project.**

This saves only the current project’s local Git settings. It does not change shared computer settings or other projects, and GitHub login does not automatically choose your commit identity. Your name and email are recorded in future commits and become visible to people who can access the repository after upload. If reading or saving fails, select **Reload settings**, check the current values, and retry.

## 6 Check that the project is ready

Select **Lead dashboard** in the sidebar. With GitHub connected, VIVA can read the cloned repository’s verified `origin` without configuring an upload target first. Confirm that the repository shown is the team repository you intended to use.

The dashboard shows open pull requests, review requests, CI results, assigned team issues, and recent workflow runs. **Zero open PRs or no CI runs can be a valid result** for a new or quiet repository. The dashboard is read-only; use its links to review or merge on GitHub. Use **Back to files** to return to your local project.

The open dashboard refreshes every five minutes and also has **Refresh**. **Unavailable** indicates an access or loading problem, rather than a zero count. Check **Coverage and checks** for details.

Cloning and connecting do not automatically upload changes. AI setup is not required for GitHub login or cloning. For saving, branches, and uploading, continue with [Getting Started](../README.md#getting-started); the [team workflow guide in Korean](team-workflow.ko.md) also covers reviews and conflicts.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| GitHub approval is still waiting or the code expired | Finish the approval in the browser, then wait in VIVA. If it timed out, select **Cancel** if available and start **Login with GitHub** again for a new code. |
| GitHub connected, but a private repository cannot be cloned or read | Open the repository in the browser with the same account. Check the invitation, team access, and any organization approval or SSO requirement. If needed, open **GitHub connected → Disconnect GitHub**, then log in again. |
| Invalid repository URL | Use `https://github.com/OWNER/REPOSITORY` or its `.git` form. Remove branch/file paths, query strings, and credentials. |
| A destination already exists, or a partial folder was preserved | Choose another **New project folder name**. Review any preserved folder before manually removing it; VIVA will not overwrite it. |
| Cannot write to a location, or not enough disk space | Choose a writable parent folder and free space if needed. Select a real folder rather than a shortcut or symbolic link. |
| Git is not found after installation | Quit and reopen VIVA, then use **Check for Git again**. On Windows, confirm Git was installed with the default PATH option. |
| Dashboard asks for a repository or cannot load activity | Check your selected project and account, then **Refresh**. Use **Choose team repository** if VIVA cannot verify the GitHub origin. A network or GitHub rate-limit error may require waiting before retrying. |
| macOS or Windows blocks installation | Check the matching installer and the OS guidance in step 1. Contact your lead or administrator if the device requires signed software; do not turn off system protections. |

When asking your lead for help, include the VIVA version, your OS and chip type, the step that failed, and a screenshot of the error. Hide tokens, device codes, and private repository details from screenshots shared outside your team.

## Message to share with teammates

> Please install VIVA 0.3.0-beta.1 using the installer for your computer: https://github.com/yhkimslv/viva/releases/tag/v0.3.0-beta.1
>
> Setup guide: https://github.com/yhkimslv/viva/blob/main/docs/user-guide.en.md
>
> Connect your own GitHub account, then use Clone from GitHub with the team repository HTTPS URL provided by your lead. Check Project Settings → Commit author before your first save. No Node.js, npm, or terminal commands are needed. This is an unsigned/unnotarized team preview, so read the installation notes before opening it.
