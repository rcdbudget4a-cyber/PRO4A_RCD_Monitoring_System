# Firebase setup

1. Create a Firebase project and add a Web App.
2. Enable **Authentication → Email/Password**.
3. Create a **Cloud Firestore** database.
4. Deploy `firestore.rules` using the Firebase CLI.
5. Add the six `NEXT_PUBLIC_FIREBASE_*` values listed in `.env.example` to the hosting environment.
6. Create an administrator account in Firebase Authentication.
7. Create `/users/{uid}` with:

```json
{
  "displayName": "System Administrator",
  "role": "administrator",
  "status": "active",
  "unitId": "RHQ",
  "unitName": "Regional Headquarters"
}
```

Collections used by the system:

- `claims`
- `users`
- `activityHistory`

The interface runs with demonstration records when Firebase is not configured.
Once configured, claim records are read from and written directly to Cloud
Firestore. Keep administrator approval and unit assignment inside `users`;
the included rules enforce unit-scoped access and administrator-only deletion.
