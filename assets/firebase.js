import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDtVdi7ehp-sLRBWfweTTezJEPy_4nsULc",
  authDomain: "pis-tests.firebaseapp.com",
  projectId: "pis-tests",
  storageBucket: "pis-tests.firebasestorage.app",
  messagingSenderId: "662273171243",
  appId: "1:662273171243:web:12fb212814af6a36772f6e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

setPersistence(auth, browserSessionPersistence).catch(console.error);

export { auth, db, googleProvider };
