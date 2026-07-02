# Fleet Trips Mobile App Plan

## Recommendation

Build one shared mobile app with React Native and Expo, then ship to Android and iOS from the same codebase.

This matches the current Fleet Trips stack because the backend is already HTTP/JSON through FastAPI, and the dashboard logic is simple enough to expose as mobile screens without duplicating business rules.

## Core Mobile Screens

- Map: current vehicle positions, route preview, Mayet cache status, and open-in-Mayet action.
- Trips: active, assigned, dispatched, done, and cancelled trips.
- Trip Detail: customer, driver, vehicle, payment status, route, timeline, and documents.
- Payments: paid, pending, vendor pending, and profit view.
- Search: vehicle plate, customer, driver, route, payment state, and order count.
- Offline/Low Network: cached last-known trips and GPS positions.

## Android and iOS Approach

- Framework: React Native with Expo.
- Auth: token-based API login, not Odoo web sessions.
- Maps: `react-native-maps`.
- Push notifications: Expo Notifications for dispatch changes, payment approvals, and route exceptions.
- Release path: Android APK/AAB first, then iOS TestFlight after Apple account setup.

## API Changes Needed

- Add a mobile auth endpoint.
- Add paginated trip list endpoints.
- Add `/api/mobile/map` for compact vehicle map payloads.
- Add `/api/mobile/trips/{id}` for one-trip detail.
- Add role-based permissions for supervisor/dispatcher/admin.

## Why Not Wrap the Website

A WebView wrapper would be faster, but it would feel weak on mobile: poor offline support, worse map performance, and no clean push notifications. React Native is the better long-term move.
