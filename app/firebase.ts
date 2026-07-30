import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase web-app configuration. These values identify the public browser app;
// access to records is enforced by Firebase Authentication and Firestore rules.
const firebaseConfig = {
  apiKey: "AIzaSyC0C4raTCm6qw85kM1Hpm6UGCOVgJiozBg",
  authDomain: "pro4a-retirees-kipo-wipo.firebaseapp.com",
  projectId: "pro4a-retirees-kipo-wipo",
  storageBucket: "pro4a-retirees-kipo-wipo.firebasestorage.app",
  messagingSenderId: "111596871513",
  appId: "1:111596871513:web:4af268554106216d40b648",
  measurementId: "G-JC038GNEC3",
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const firebaseApp = firebaseConfigured
  ? (getApps()[0] ?? initializeApp(firebaseConfig))
  : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
