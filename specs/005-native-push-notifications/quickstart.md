# Quickstart: Native-Looking PWA Push Notifications

## Prerequisites

- Famstagram development dependencies are installed.
- The development database is migrated and seeded.
- Valid push/VAPID configuration is available for local delivery testing.
- A supported desktop or mobile browser is available, including an installed or installable PWA context where supported.
- At least two authorized family accounts exist so actor, recipient, mute, and authorization cases can be exercised.

## Automated validation

Run the focused notification tests and production build from the repository root:

```powershell
npm test -- --runInBand
npm run build
```

The focused coverage should verify:

- event-specific title/body construction for post, comment, and mention notifications;
- stable notification identity, destination, branding metadata, and bounded text;
- authorization, mute, self-event, and in-app notification preservation;
- duplicate handling for repeated delivery attempts and multiple subscriptions;
- subscription permission/state responses and recovery behavior, including current-browser endpoint ownership;
- legacy receipt/payload compatibility and the absence of subscription keys, private media URLs, or notification text in diagnostics.

## Manual PWA validation matrix

1. Sign in as a recipient and open notification settings.
2. Confirm the initial state explains push benefits and does not repeatedly prompt without an intentional action.
3. Enable push notifications and confirm the displayed state matches the browser permission and stored subscription.
4. From another authorized account, create representative activity: a new post, a comment, and a mention.
5. Verify each alert uses the Famstagram icon/badge, concise actor/activity wording, readable hierarchy, and no raw payload fields.
6. Repeat delivery while the PWA is foregrounded, backgrounded, and closed. Confirm there is no redundant foreground alert and that background/closed delivery remains actionable.
7. Tap each alert. Confirm an existing Famstagram window is reused when possible, the related authorized post opens directly, and no duplicate tab is created.
8. Delete or revoke access to the related post, then tap the stale alert. Confirm the user sees a safe fallback without private content leakage.
9. Deny permission or simulate an unsupported context. Confirm settings show the truthful state, preserve in-app notifications, and provide a recovery action.
10. Disable push on one active subscription. Confirm later activity remains in the in-app notification center and does not produce a push alert for the disabled subscription.
11. Trigger a repeated delivery attempt for one event and inspect the device notification surface. Confirm the event is not shown as confusing duplicate alerts.
12. Repeat the key checks at representative desktop and mobile viewport sizes and verify no clipped controls, overflowing text, or broken safe-area spacing.

## Expected outcomes

- All focused automated tests and the production build pass.
- Supported notification events share a polished, native-looking presentation while retaining private routing.
- Notification taps reach the correct authorized activity or a safe fallback.
- Permission, subscription, failure, and disabled states are truthful and recoverable.
- In-app notifications remain available whenever push delivery is unavailable.
