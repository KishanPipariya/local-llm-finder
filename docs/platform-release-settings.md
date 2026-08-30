# Platform release settings

These settings live outside the repository. Verify them in the named project
before release and after changing hosting or repository ownership.

## Vercel request logs

1. Open the production project, then **Logs**.
2. Confirm which team roles can read runtime logs and whether a Log Drain is
   configured.
3. Confirm the plan's current retention window. Runtime request details can
   contain the request path and search parameters, so compare the result with
   the `/privacy` notice.
4. Keep Vercel Web Analytics disabled unless the product's no-analytics promise
   is deliberately changed alongside the notice and UI.

Record the review date and outcome in the release issue; do not copy submitted
configuration URLs into the issue.

## Vercel recommendation API rate limit

Use the platform firewall instead of an in-process IP map:

1. Open **Firewall → Configure** and create a rule named
   `Recommendation API rate limit`.
2. Match **Request Path → Equals → `/api/recommendations`**. If the dashboard
   offers a request-method condition, also match `POST`.
3. Start with the **Log** action and observe legitimate traffic before choosing
   a threshold.
4. Change the action to **Rate Limit** with a `429` response. Choose the window
   and request count from observed traffic and the account's usage limits rather
   than embedding an unverified threshold here.
5. Publish the firewall configuration, run `npm run monitor:deploy`, and confirm
   ordinary form and API requests remain successful.

Vercel's checked-in `vercel.json` WAF syntax supports challenge and deny, but
not rate-limit actions, so this rule must be configured in the project firewall.

## GitHub private vulnerability reporting

1. Open **Settings → Security → Advanced Security** for the public repository.
2. Enable **Private vulnerability reporting**.
3. Open the repository's **Security → Advisories** page in a signed-out session
   and confirm **Report a vulnerability** is available.
4. Subscribe repository administrators to security-alert notifications so a
   private report is not missed.

## Production monitoring

`.github/workflows/production-monitor.yml` runs every six hours and on manual
dispatch. It calls `npm run monitor:deploy`, which checks the server-rendered GET
flow plus all four runtime-specific JSON flows and fails on HTTP errors, invalid
or empty results, or any stale catalogue response. The command logs statuses and
runtime names, never submitted configuration values.

Enable GitHub Actions failure notifications for the repository owner. Scheduled
workflows run from the default branch, so the monitor becomes active only after
these changes reach `main`.
