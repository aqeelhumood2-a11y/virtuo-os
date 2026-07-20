import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { type Auth, getAuth } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type FirebaseStorage, getStorage } from "firebase/storage";

import { getFirebaseConfig } from "./config";

function createFirebaseApp(): FirebaseApp {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  return initializeApp(getFirebaseConfig());
}

export const firebaseApp = createFirebaseApp();
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
export const storage: FirebaseStorage = getStorage(firebaseApp);
