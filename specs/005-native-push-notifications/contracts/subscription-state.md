# Subscription State Contract

## Purpose

Define the authenticated browser-facing behavior for push subscription state and recovery.

## Read state

The current subscription endpoint returns enough information for the settings UI to distinguish:

- push capability is unavailable;
- permission is denied, default, or granted;
- the current browser has an active subscription;
- the server has no valid subscription for the current browser/device;
- push configuration or delivery is temporarily unavailable.

The response MUST NOT expose another user's subscription endpoint or cryptographic keys.

## Write operations

- Enable: accepts only a validated browser subscription from the authenticated user and stores or updates the endpoint using the existing uniqueness and ownership rules.
- Disable: removes only the authenticated user's selected endpoint and unsubscribes the current browser where supported.
- Retry/recover: returns the user to an intentional permission/subscription action; it must not loop prompts or claim success before server verification.

## Invariants

- Authentication is required for all subscription reads and writes.
- Invalid subscription input is rejected without creating a partial record.
- Push failure does not delete the corresponding in-app notification.
- State labels and controls reflect the actual browser and server state, not merely the presence of any account subscription.
