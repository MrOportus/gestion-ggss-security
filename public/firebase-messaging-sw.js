
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBJ-1CfRG63DvsD5Enp2Eys-WvGrenMljE",
    authDomain: "gen-lang-client-08607869-461c2.firebaseapp.com",
    projectId: "gen-lang-client-08607869-461c2",
    storageBucket: "gen-lang-client-08607869-461c2.firebasestorage.app",
    messagingSenderId: "1058074609900",
    appId: "1:1058074609900:web:a31516306067f7b55ffdc9",
    measurementId: "G-0WBLMDBZW2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/logo.png'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
