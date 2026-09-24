import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyDVdhuxy7e5R8zdd7Qw9HvC9AFR70dLmG0',
  authDomain: 'cars-realtime-database.firebaseapp.com',
  databaseURL: 'https://cars-realtime-database-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'cars-realtime-database',
  storageBucket: 'cars-realtime-database.firebasestorage.app',
  messagingSenderId: '992285748221',
  appId: '1:992285748221:web:8dfa2738a7bf650cac4794',
  measurementId: 'G-HT31TH9BK2',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
// Anonymous Auth permite proteger RTDB sin pedir registro y evita que una copia
// alojada en un dominio no autorizado pueda iniciar sesión en este proyecto.
export const authReady = signInAnonymously(auth);
