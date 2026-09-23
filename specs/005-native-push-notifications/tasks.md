---

description: "Task list for native-looking PWA push notifications"
---

# Tasks: Native-Looking PWA Push Notifications

**Input**: Design documents from `/specs/005-native-push-notifications/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Tests**: Included because the feature specification requires focused automated regression coverage and the project constitution requires tests for push delivery, browser APIs, authorization, and user-critical behavior.

**Organization**: Tasks are grouped by user story so each increment can be implemented and tested independently after the shared foundation.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish focused fixtures and test boundaries without changing runtime behavior.

- [X] T001 [P] Add reusable push-event fixtures covering post, comment, mention, long text, and legacy payload shapes in `tests/fixtures/push-events.ts`
- [X] T002 [P] Add service-worker test helpers for normalizing payloads, notification options, and click targets in `tests/push-test-helpers.ts`
- [X] T003 [P] Add contract-focused assertions for payload and subscription-state invariants from `specs/005-native-push-notifications/contracts/` in `tests/push-contracts.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make notification identity, authorization, and compatibility rules explicit before story-specific work.

**⚠️ CRITICAL**: No user story implementation should begin until this phase is complete.

- [X] T004 Define a stable recipient-scoped notification identity and normalized payload type while preserving legacy fields in `lib/push.ts`
- [X] T005 Thread the existing `Notification.id`, `feedId`, and related destination context through notification delivery without changing recipient, mute, mention, or self-event policy in `lib/notifications.ts`
- [X] T006 Verify the existing `Notification` and `PushSubscription` uniqueness, authorization, and cleanup constraints remain sufficient for this feature, documenting any required migration decision in `prisma/schema.prisma`
- [X] T007 [P] Add focused authorization fixtures for authorized, unauthorized, signed-out, stale-post, and multi-subscription recipients in `tests/push-authorization.test.ts`

**Checkpoint**: The existing notification record is the source of push identity, all delivery remains private, and story work can proceed without inventing a second notification store.

---

## Phase 3: User Story 1 - Receive Clear Native-Looking Alerts (Priority: P1) 🎯 MVP

**Goal**: Deliver all existing supported notification events with consistent Famstagram branding, concise bounded content, and no redundant foreground alerts.

**Independent Test**: Trigger post, comment, and mention notifications for a subscribed recipient in foreground, background, and closed-PWA contexts; verify branding, actor/activity wording, bounded text, and preserved in-app fallback.

### Tests for User Story 1

- [X] T008 [P] [US1] Add runtime tests for event-specific titles, bodies, icon/badge metadata, deterministic tags, notification IDs, safe truncation, and legacy payload compatibility in `tests/push-notifications.test.ts`
- [X] T009 [P] [US1] Add service-worker behavior tests for malformed payload defaults, duplicate tags, foreground broadcast behavior, and native notification option construction in `tests/service-worker-push.test.ts`

### Implementation for User Story 1

- [X] T010 [US1] Implement branded, bounded, event-specific push content and stable tags for post, comment, mention, and test events in `lib/push.ts`
- [X] T011 [US1] Pass the persisted notification identity and destination metadata into every optional push send while keeping in-app notification creation first and push failures non-fatal in `lib/notifications.ts`
- [X] T012 [US1] Normalize legacy and current payloads, apply Famstagram icon/badge/options, suppress duplicate event displays, and avoid redundant foreground alerts while broadcasting activity to open clients in `public/sw.js`
- [X] T013 [US1] Preserve diagnostic receipt behavior and add safe event identity fields without logging subscription keys or private media data in `app/api/push/receipt/route.ts`

**Checkpoint**: Every supported push event has a consistent native-looking presentation and remains available in-app when push is unavailable.

---

## Phase 4: User Story 2 - Open the Right Place from an Alert (Priority: P1)

**Goal**: Make notification taps reuse the current Famstagram client when possible, open the authorized related destination directly, and fall back safely for stale content.

**Independent Test**: Tap representative alerts while the PWA is closed, backgrounded, and open on another route; verify one correct authorized destination, no duplicate tabs, and a safe fallback for deleted or inaccessible content.

### Tests for User Story 2

- [X] T014 [P] [US2] Add click-routing tests for existing-client reuse, client navigation, closed-PWA opening, duplicate interaction, signed-out recovery, and stale destination fallback in `tests/service-worker-click.test.ts`
- [X] T015 [P] [US2] Add authenticated notification-acknowledgement tests proving only the recipient can mark the referenced notification handled/read in `tests/notification-acknowledgement.test.ts`

### Implementation for User Story 2

- [X] T016 [US2] Add an authenticated, recipient-scoped notification acknowledgement action with safe not-found behavior in `app/actions/notifications.ts`
- [X] T017 [US2] Extend the push receipt/acknowledgement route to validate notification identity and session ownership before updating in-app state in `app/api/push/receipt/route.ts`
- [X] T018 [US2] Update notification-click handling to prefer an existing Famstagram client, navigate/focus it to the relative target, acknowledge the event safely, and open one fallback window only when needed in `public/sw.js`
- [X] T019 [US2] Handle selected notification destinations and unavailable-post fallback messaging without bypassing existing route authorization in `app/(app)/notifications/page.tsx`

**Checkpoint**: Tapping any valid alert reaches the correct private activity in one interaction, while stale or unauthorized targets remain safe and understandable.

---

## Phase 5: User Story 3 - Control Notification Permission and Delivery (Priority: P2)

**Goal**: Make enable, disable, denied, unsupported, and recovery states truthful and intentional on supported desktop/mobile PWA contexts.

**Independent Test**: Exercise notification settings through default, granted, denied, revoked, unsupported, server-unverified, enabled, and disabled states; confirm the UI reflects actual state and in-app notifications remain available.

### Tests for User Story 3

- [X] T020 [P] [US3] Add subscription route tests for authenticated reads/writes, current-endpoint state, invalid input, endpoint ownership, disable behavior, and server verification failure in `tests/push-subscription.test.ts`
- [X] T021 [P] [US3] Add component-state tests for intentional permission prompts, denied/unsupported recovery, truthful enabled state, and accessible labels in `tests/push-subscription-control.test.tsx`

### Implementation for User Story 3

- [X] T022 [US3] Return truthful current-browser capability, permission, and server-subscription state while preserving endpoint validation and authenticated ownership rules in `app/api/push/subscription/route.ts`
- [X] T023 [US3] Refine enable/disable/retry flows to request permission only after intentional action, verify the saved endpoint, and distinguish browser state from account-wide state in `components/PushSubscriptionControl.tsx`
- [X] T024 [US3] Update the global PWA prompt so installation and notification guidance is non-repeating, device-appropriate, dismissible, and consistent with actual capability in `components/PushNotifications.tsx`
- [X] T025 [US3] Add concise accessible help, state labels, and recovery guidance for push delivery without changing existing mute semantics in `app/(app)/notifications/settings/page.tsx`

**Checkpoint**: Members can intentionally enable, disable, and recover push notifications, and no UI claims push delivery is active when it is not.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify regression safety, privacy, accessibility, and responsive PWA quality across all stories.

- [X] T026 [P] Update feature validation notes and expected manual scenarios to match the implemented payload, click, and subscription behavior in `specs/005-native-push-notifications/quickstart.md`
- [X] T027 [P] Review notification strings, icon/badge assets, truncation, contrast, keyboard access, and safe-area layout at representative desktop/mobile sizes in `public/sw.js`, `components/PushSubscriptionControl.tsx`, and `app/(app)/notifications/settings/page.tsx`
- [X] T028 Run the focused notification test command and fix feature-caused regressions across `tests/`
- [X] T029 Run the production build and resolve feature-caused type, route, service-worker, or asset errors with `npm run build`
- [ ] T030 Execute the full manual PWA matrix, including foreground/background/closed states, permission denial/retry, stale destinations, duplicate delivery, and multi-device subscriptions, using `specs/005-native-push-notifications/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001-T003 can run in parallel.
- **Foundational (Phase 2)**: Depends on Phase 1; T004-T006 establish shared identity and privacy rules, while T007 can run in parallel with T004-T006.
- **User Stories (Phases 3-5)**: Depend on Phase 2. US1 and US3 can begin in parallel after the foundation; US2 depends on the stable payload identity from US1/T004 and should follow the click contract established by US1.
- **Polish (Phase 6)**: Depends on all selected user-story tasks; T026-T027 can run in parallel, then T028-T030 validate the integrated result.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Phase 2; no dependency on another story. MVP increment.
- **User Story 2 (P1)**: Starts after Phase 2 and uses the stable notification identity from T004/T010; it remains independently testable with fixture payloads.
- **User Story 3 (P2)**: Starts after Phase 2; independent of click routing and preserves the same in-app fallback contract.

### Within Each User Story

- Tests are written before the implementation they cover and should fail for the new behavior first.
- Payload/identity changes precede service-worker behavior; authenticated acknowledgement precedes click integration.
- Route/service changes precede component integration.
- Each checkpoint must pass its independent test criteria before the next story is merged.

### Parallel Opportunities

- Phase 1: T001, T002, and T003 touch separate test/contract files.
- Phase 2: T004-T006 are sequential around the shared payload/identity boundary; T007 is parallel.
- US1: T008 and T009 are parallel test work; T010-T011 are sequential before T012; T013 can proceed alongside service-worker work after the payload shape is fixed.
- US2: T014 and T015 are parallel tests; T016-T017 can proceed in parallel with test authoring, then T018-T019 integrate the result.
- US3: T020 and T021 are parallel tests; T022 can proceed before T023, while T024 and T025 can proceed in parallel once the state contract is fixed.
- Across stories: US1 and US3 can be staffed in parallel after Phase 2; US2 follows the shared identity work.

---

## Parallel Example: User Story 1

```text
Task T008: Add push content/payload tests in tests/push-notifications.test.ts
Task T009: Add service-worker behavior tests in tests/service-worker-push.test.ts

After the tests define the expected contract:
Task T010: Implement content and tags in lib/push.ts
Task T011: Thread identity through lib/notifications.ts
Task T012: Implement worker presentation in public/sw.js
Task T013: Preserve safe receipt diagnostics in app/api/push/receipt/route.ts
```

## Parallel Example: User Story 2

```text
Task T014: Add click-routing tests in tests/service-worker-click.test.ts
Task T015: Add acknowledgement authorization tests in tests/notification-acknowledgement.test.ts

After the contract is fixed:
Task T016: Add the authenticated action in app/actions/notifications.ts
Task T017: Extend app/api/push/receipt/route.ts
Task T018: Integrate worker click routing in public/sw.js
Task T019: Add safe notification-page fallback in app/(app)/notifications/page.tsx
```

## Parallel Example: User Story 3

```text
Task T020: Add subscription API tests in tests/push-subscription.test.ts
Task T021: Add control-state tests in tests/push-subscription-control.test.tsx

After state semantics are fixed:
Task T022: Update app/api/push/subscription/route.ts
Task T023: Update components/PushSubscriptionControl.tsx
Task T024: Update components/PushNotifications.tsx
Task T025: Update app/(app)/notifications/settings/page.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2 to establish fixtures, stable identity, and privacy constraints.
2. Complete Phase 3 (US1) to deliver branded, concise, bounded alerts with in-app fallback.
3. Run T028 and T029, then perform the US1 independent test across foreground/background/closed contexts.
4. Stop and demo the native-looking alert presentation before expanding click and settings behavior.

### Incremental Delivery

1. Foundation ready → implement US1 → validate and demo the presentation MVP.
2. Add US2 → validate deep-linking, acknowledgement, and stale-destination safety.
3. Add US3 → validate permission, subscription, and recovery states.
4. Complete Phase 6 → run build, regression, accessibility, responsive, and manual PWA checks.

### Parallel Team Strategy

1. One developer completes Phase 2 identity/authorization work.
2. After Phase 2, one developer owns US1 push content/worker behavior while another owns US3 subscription/settings behavior.
3. A third developer can prepare US2 click/acknowledgement tests and integration after the stable payload identity is available.
4. Integrate at checkpoints before cross-cutting validation.

---

## Notes

- `[P]` tasks touch different files and have no dependency on incomplete work.
- `[US1]`, `[US2]`, and `[US3]` map directly to the prioritized stories in `spec.md`.
- No Prisma migration is expected unless implementation proves stable event identity cannot use the existing `Notification.id`.
- Do not expose subscription keys, public media URLs, or unauthorized post data in push payloads, receipts, logs, or fallback UI.
