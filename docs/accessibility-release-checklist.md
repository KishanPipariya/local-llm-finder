# Accessibility release checklist

Run this checklist for public finder UI changes. It supplements, but does not replace, an independent accessibility audit; do not publish a conformance claim from this checklist alone.

The automated Playwright/axe suite covers keyboard interaction, validation and
focus recovery, 320 and 375 CSS-pixel reflow, light and dark themes, reduced
motion, WCAG text-spacing overrides, and operation without JavaScript. The
manual checks below remain necessary for assistive-technology behavior and
human visual review.

- [x] Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:a11y`.
- [ ] With keyboard only, complete the finder, submit it, use the skip link, open and close installation guidance, and open a model link. Confirm visible focus and logical focus order throughout.
- [ ] In Safari with VoiceOver, review the initial form, validation error summary and messages, catalogue-error message, empty results, populated results, stale-catalogue notice, runtime labels, and expanded installation guidance.
- [ ] In Firefox or Chrome with NVDA, repeat the VoiceOver review and verify announced labels, status, and new-tab disclosure.
- [ ] At 400% browser zoom and at a 320 CSS-pixel viewport, confirm reflow, readable result metrics, no clipped controls, and no horizontal scrolling.
- [ ] Apply WCAG text-spacing overrides and confirm that text, cards, controls, and guidance remain readable without clipping or overlap.
- [ ] Enable reduced motion and verify that navigation and focus changes do not depend on animation.
- [ ] Review foreground/background, focus, borders, and status indicators with a contrast tool: normal text must be at least 7:1; large text at least 4.5:1; UI boundaries, indicators, and focus at least 3:1. Confirm status meaning is also expressed in text.
