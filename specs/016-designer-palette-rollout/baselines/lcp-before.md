# Baseline LCP (Lighthouse Mobile + Slow 3G)

**Task**: T001
**Status**: ⚠ **PENDING MANUAL CAPTURE**

Lighthouse + Slow 3G emulation requires browser interaction that the implementation agent cannot perform autonomously. The capture should be done by a human reviewer before Phase 8 (US6 Inter migration) lands, so a meaningful before/after comparison is possible.

## Instructions

1. Open Chrome DevTools on `/login` (baseline state — before any 016 changes).
2. Switch to the **Lighthouse** panel.
3. Configure: **Mobile**, **Performance** category, **Simulated throttling = Slow 3G**.
4. Run audit. Record:
   - LCP value (ms)
   - FCP value (ms)
   - Screenshot of the LCP frame
5. Repeat for `/` (dashboard, logged in).
6. Replace this file's "Pending manual capture" section with the actual numbers.

## Pending manual capture

```text
/login   LCP: ???ms   FCP: ???ms   (date: ____)
/        LCP: ???ms   FCP: ???ms   (date: ____)
```

## After capture

Once captured, the `after` measurements taken in T058 (post Phase 8) should be in `lcp-after.md`. SC-006 expects ≥ 100ms improvement OR ausência confirmada de FOUT.
