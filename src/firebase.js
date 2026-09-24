import { initializeApp } from 'firebase/app';
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
export const db = getDatabase(app);
