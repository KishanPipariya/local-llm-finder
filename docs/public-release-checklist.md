# Public release checklist

Complete these operator and legal decisions before announcing a production URL.

- [x] Use the existing Vercel hostname for the initial public release; a custom
  domain is intentionally deferred.
- [ ] Review Vercel request-log access and retention against the privacy notice.
- [x] Configure platform-level abuse protection for `/api/recommendations`
  without adding application-level IP tracking. Confirm valid GET and POST form
  traffic is not blocked.
- [x] Add a scheduled production monitor for finder 5xx responses, catalogue
  `503`s, invalid results, and stale catalogues without logging submitted
  configurations.
- [x] Enable GitHub Actions failure notifications for the scheduled production
  monitor.
- [x] Keep the same-origin JSON route as an internal adapter rather than a
  versioned public API; do not enable CORS or promise a compatibility window.
- [x] Enable GitHub private vulnerability reporting so `SECURITY.md`'s private
  report workflow is available to researchers.
- [x] Publish the source under the MIT License.
- [ ] Complete `docs/accessibility-release-checklist.md` with VoiceOver, NVDA,
  zoom, text-spacing, reduced-motion, and contrast checks.
- [ ] Run `npm run verify`, deploy, warm the catalogue, and run
  `npm run monitor:deploy`.

See `docs/platform-release-settings.md` for the exact Vercel, GitHub, and
monitoring configuration steps.
