# Argus Watch user guide

Only features marked **available** work in the current version. Everything marked *planned* is not implemented yet.

## 1. Create an account / sign in — available (GitHub only)

There is no separate account. Open the site and click **Sign in with GitHub**. GitHub asks you to authorise the Argus Watch App to read your public profile and email; that is all sign-in needs. Google sign-in is *planned*.

## 2. Connect a GitHub repository — available

1. Open **Repos** (header). Click **Connect GitHub**.
2. GitHub shows the App installation page. Choose the account and either all repositories or selected ones. Private repositories are supported.
3. GitHub returns you to Argus Watch. The installation is accepted only if GitHub confirms it belongs to your signed-in account.
4. In **2 · Choose repositories**, tick the repositories to monitor and click **Watch selected**. Argus Watch reads the lockfiles at the current commit and lists the packages it found.

What is accessed and why, what is stored, and how to revoke are explained on the Repos page. Uninstalling the App on GitHub (Settings → Applications) revokes everything.

## 3. Start monitoring — available (automatic)

Monitoring starts as soon as a repository is watched. New advisories and disclosures are matched against your packages and technology tags continuously; a push to the default branch refreshes the package list via webhook; **Rescan** does it now. The **Sources** page shows every source, how it is monitored, and measured intervals.

## 4. View security alerts — available

The **Watch** page shows, per repository, how many alerts need attention; counts by severity (stated by the advisory, or marked *estimated*), new, unread and resolved; and one card per alert with the problem in one line, the suggested fix in one line, the affected file and lines, and actions. Filters: needs action, new, all, resolved, not affected. "No issues found in inspected files" is evidence from what was inspected, never proof of safety.

## 5. Inspect the affected code — available

Click **View code** or the file:line link. The case page opens with the cited lines highlighted in a read-only source pane at the assessed commit, with a GitHub permalink for each line. **Open in…** offers GitHub, VS Code and Cursor (after you enter your local checkout path once), and a Claude Code link that prefills a prompt (the `claude-cli://` scheme is not registered by every Claude Code install; the copy-command fallback always works). If no line could be cited, the card says "exact location not available" instead of guessing.

## 6. Preview suggested changes — available

On the case page, **Draft fix** asks the model for a minimal change to the cited files (and the manifest when the advisory names a package upgrade). You see a diff (additions shown as ghost text), the hunks that could not be applied and why, a syntax check result, and the **static remediation assessment**: which conditions the patch touches, what changed after re-assessing the patched text (with citations verified), a computed version check, risk flags, the model's own judgement (marked as an assumption), what is still uncertain, and what verification is required. The status ladder always ends with **Security remediation: not verified**: nothing is executed here.

## 7. Approve a fix — available (requires opt-in)

On **Repos**, enable **Allow draft pull requests** for the repository. Then on the case page click **Approve & open draft PR…**. The dialog states the repository, base branch, new branch name, files, that a *draft* PR will be opened, that nothing is merged and the default branch is untouched, and the assessment label. Tick "I reviewed the diff" and approve. Shared demo repositories never receive pull requests.

## 8. Commit or create a pull request — available (draft PR only)

Approval creates one commit on a new branch `argus/fix-…` and opens a draft pull request with the full explanation and the "not verified" statement in its body. If the cited files changed on the default branch since the analysis, nothing is written and you are asked to re-run the analysis. The repository's own CI results appear in a separate panel ("Repository CI") with a note that CI does not verify that the vulnerability is fixed. Merging is always your action on GitHub. Direct commits to the default branch and automatic merges are not offered by design.

## 9. Use a coding assistant instead — available

**Generate fix prompt** downloads `REMEDIATION.md`, a provenance-tagged brief for Meta Muse Code, Claude Code, Codex or any agent, with the untrusted advisory text fenced as data. The case page shows the terminal commands.

## 10. Notifications and language — available

- **Alerts** (header badge) counts unread notifications; the **Notifications** page lists them, newest and unread first, one entry per finding and repository. A changed verdict or severity updates the entry and marks it unread again; the same report from several sources never notifies twice.
- **Settings**: in-app notifications on/off, a personal Slack or Discord webhook, and **browser push** (enable per device; the browser asks for permission once; on iOS add the site to the Home Screen first). Email notifications are *planned*.
- **Language**: the selector in the header lists every language supported by Google Cloud Translation. Switching re-renders the current page in place: your open alert, filters and unsaved dialog state stay. Code, file paths, package names, versions and advisory ids are never translated. If the deployment has no translation key, only English is offered.

## Not available in this version (planned)

Google sign-in; email notifications; a VS Code extension or JetBrains plugin that applies the change locally (deep links only); X, LinkedIn, Threads and Reddit as sources; re-assessment of open alerts on every push; execution-based validation of any kind (never planned: Argus Watch does not run repository code).
