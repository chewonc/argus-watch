# SaveBell user guide

Features marked **available** work in the current version. **Needs setup** means it works once the deployment owner configures it (see `SETUP.md`). *Planned* is not implemented.

## 1. Sign in — available (GitHub)

Open the site and click **Sign in with GitHub**. GitHub asks you to authorise the SaveBell App to read your public profile and email. Google sign-in is *planned*.

## 2. Connect a repository — available

1. Open **Repositories** from the account menu and click **Connect GitHub**.
2. On GitHub, choose the account and either all or selected repositories (private repositories work).
3. Back in SaveBell, tick the repositories to monitor and click **Start monitoring**.
4. SaveBell reads the lockfiles at the current commit and immediately checks the last 30 days of threats that match your dependencies. The confirmation says how many it is checking; results appear in **Alerts** within minutes.

Settings → Repositories explains what is read, stored and written, and how to revoke access (new users see the same steps at first sign-in). **Stop monitoring** removes a repository; uninstalling the App on GitHub revokes everything.

## 3. Monitoring — available (automatic)

New advisories, CVEs, research papers and security news are checked continuously against your packages and stack. **Sources** shows every source, how often it really runs, and why some sources (X, LinkedIn, Threads, Reddit) are not used.

Every report that could affect a watched repository is **fact-checked** first. On the alert page, *Is this threat real?* shows the label (Verified, Corroborated, Unverified, Disputed, Likely false), the registry records, primary sources, independent reports, copies and contradictions that decided it. This is about the report, not about your code.

## 4. Alerts and notifications — available

- **Alerts** lists one card per threat and repository: a status (Serious, Important, Moderate, Minor, Possible issue), a plain title, the file and line when confirmed, and the report's credibility.
- The bell in the header counts unread notifications. **Notifications** lists them with unread and confirmed issues first, then by severity and time; *time* order is available with `?sort=time`. A changed verdict or severity updates the entry instead of adding another.
- Settings: in-app notifications, a personal Slack or Discord webhook, and browser push (needs setup: VAPID keys). Email is *planned*.

## 5. Inspect the affected code — available

The alert page shows what is wrong, how to fix it, **Open file in GitHub** at the exact lines, and under *Technical details* the conditions with their evidence, the highlighted source at the assessed commit, and *How this was analysed* (including the files Meta Muse Spark explored).

## 6. What happens if you don't fix this? — available

Click **Simulate user impact**. You get a short walkthrough, drawn as screens of your own app, of what someone using it could experience. Each step is labelled *Shown in your code*, *Inferred from your code* or *Hypothetical*, with links to the lines. When a fix exists, switch to **With fix** to see where the chain is expected to stop and what is still uncertain. The data is synthetic and nothing is executed. If your code shows no user-facing path, it says so instead of inventing one.

## 7. Fix it — needs setup

1. Click **Fix** on an alert. A preview diff, a syntax check and a static remediation assessment appear.
2. Enable changes for the repository in Settings → Repositories (one time).
3. Choose **Fix & create PR** (recommended) or **Fix & push**. The dialog states exactly which files may change, which tests will run, and what happens on failure. Tick the review box and authorize.
4. Meta Muse Code edits a fresh copy of the repository in an isolated runner, your tests run there, and the progress ladder shows each step with timestamps and links. On success you get the pull request link; in push mode SaveBell merges it only after your repository's checks pass and branch protection allows it, otherwise the PR stays open for review.

Passing tests do not prove the vulnerability is gone; the page always says so.

## 8. Use your own coding agent (MCP) — available

**Settings → Connect AI agent** creates a personal token and shows the configuration for **Meta Muse Code**, Claude Code, Codex or any MCP client. The agent can list alerts, read the evidence and cited code, and report its own result with exact quotes; it never changes SaveBell's verdict. Each alert page has a copyable request for your agent.

## 9. Language — available

Use the 🌐 selector in the header. Korean is built in; other languages are translated by Meta Muse Spark and cached. Code, file paths, package names, versions and advisory ids are never translated. The choice is remembered.

## Not available in this version

Google sign-in; email notifications; IDE plugins (links and MCP only); X, LinkedIn, Threads and Reddit as sources.
