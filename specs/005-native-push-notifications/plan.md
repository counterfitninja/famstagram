# Implementation Plan: Native-Looking PWA Push Notifications

**Branch**: `counterfitninja-push-notifications` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-native-push-notifications/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Improve the existing Famstagram PWA push experience so alerts have consistent app branding, concise event-specific content, stable deep-link behavior, and truthful permission/subscription recovery states. Extend the existing `lib/push.ts` payload boundary and `public/sw.js` service worker rather than introducing a new delivery provider or notification store. Reuse existing `Notification` records as stable event identity, preserve in-app notification creation before optional push delivery, and keep all click destinations behind normal authentication and family-feed authorization.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19, Next.js 15 App Router

**Primary Dependencies**: Prisma 6 with SQLite, Tailwind CSS, `web-push`, iron-session, browser Push/Notification/Service Worker APIs

**Storage**: Existing Prisma-managed SQLite `Notification`, `PushSubscription`, and notification preference records; no new persistent entity planned

**Testing**: Existing TypeScript/runtime test setup under `tests/`, focused push/payload and authorization regression tests, `npm run build`, and manual responsive PWA/browser checks

**Target Platform**: Authenticated desktop and mobile browsers with installable PWA support where available

**Project Type**: Full-stack Next.js web application with server actions, route handlers, authenticated pages, and a browser service worker

**Performance Goals**: Push content construction and subscription-state reads complete within the existing notification request budget; notification taps route to an existing destination in one user interaction without duplicate tabs

**Constraints**: Preserve private-by-default family authorization, existing notification/mute semantics, in-app fallback on push failure, validated subscription input, authenticated media access, legacy payload compatibility, and graceful unsupported-browser behavior

**Scale/Scope**: One shared push payload/content boundary, one service worker, existing subscription/settings UI and APIs, notification click/read routing, focused tests, and no new provider or broad notification redesign

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Private-by-Default Family Sharing**: PASS. Push payloads carry authenticated relative destinations and existing feed context; service-worker clicks re-enter normal session and family authorization checks.
- **II. Validated Media and Input Boundaries**: PASS. Subscription input continues through the existing validation boundary; notification text is bounded before delivery and no public media path is introduced.
- **III. Explicit Authentication and Sensitive Operations**: PASS. Subscription APIs remain authenticated, cryptographic subscription values are never shown in notification content, and stale/deep-link flows cannot bypass authorization.
- **IV. Tested User-Critical Behavior**: PASS with focused tests for payload/presentation, duplicate identity, click routing, subscription state, authorization, mute behavior, and push-failure fallback, plus build and manual PWA checks.
- **V. Simple, Observable, and Compatible Evolution**: PASS. The design extends the existing push helper, service worker, subscription controls, and notification center; legacy payload parsing and in-app fallback remain supported.
- **VI. Responsive PWA and Layout Integrity**: PASS. Permission/recovery controls and status text are checked at representative mobile and desktop sizes, including installed-PWA safe areas and overflow.
- **Gate status**: PASS. No constitution violations or unresolved design clarifications remain.

### Post-Design Re-check

- **I. Private-by-Default Family Sharing**: PASS. No notification payload contains public media URLs or bypasses the existing authenticated destination.
- **II. Validated Media and Input Boundaries**: PASS. Existing subscription validation and bounded notification content remain authoritative.
- **III. Explicit Authentication and Sensitive Operations**: PASS. Read/click acknowledgement paths use the current session and do not trust push subscriptions as authorization.
- **IV. Tested User-Critical Behavior**: PASS. `quickstart.md` covers automated regression and foreground/background/closed-PWA, denied-permission, stale-destination, duplicate, and responsive checks.
- **V. Simple, Observable, and Compatible Evolution**: PASS. No new provider or durable delivery table is required; invalid subscriptions continue to be cleaned up and in-app events remain observable.
- **VI. Responsive PWA and Layout Integrity**: PASS. Settings and browser notification behavior are included in mobile/desktop validation.
- **Post-design gate status**: PASS. No new violations were introduced by the design.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
app/
├── (app)/notifications/page.tsx
├── (app)/notifications/settings/page.tsx
├── actions/notifications.ts
├── api/push/subscription/route.ts
└── api/push/receipt/route.ts
components/
├── PushNotifications.tsx
├── PushSubscriptionControl.tsx
└── ServiceWorkerRegister.tsx
lib/
├── notifications.ts
├── notification-policy.ts
└── push.ts
public/
└── sw.js
prisma/
└── schema.prisma
tests/
├── comment-notifications.test.ts
└── [focused push/service-worker tests]
```

**Structure Decision**: Keep the existing single Next.js application structure. Extend push content and delivery in `lib/push.ts`, service-worker presentation/click handling in `public/sw.js`, authenticated subscription and notification actions in `app/api/push` and `app/actions`, and state/recovery UI in the existing notification components/pages. Use the current Prisma models unless implementation demonstrates that an additional durable delivery field is necessary. Add focused tests under `tests/`; no new app boundary or external service is introduced.

## Complexity Tracking

No constitution violations require additional complexity justification.
