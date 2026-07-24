const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gen-lang-client-08607869-461c2' });

async function setCors() {
  const bucket = admin.storage().bucket('gen-lang-client-08607869-461c2.appspot.com');
  const corsConfiguration = [
    {
      origin: ['*'], // Or specifically 'https://gen-lang-client-08607869-461c2.web.app'
      method: ['GET', 'OPTIONS'],
      maxAgeSeconds: 3600
    }
  ];

  try {
    await bucket.setCorsConfiguration(corsConfiguration);
    console.log('✅ CORS configuration successfully applied to bucket gen-lang-client-08607869-461c2.appspot.com');
  } catch (error) {
    console.error('❌ Failed to set CORS:', error);
  }
}

setCors();
