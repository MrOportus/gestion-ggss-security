const admin = require('firebase-admin');
const path = require('path');
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

const db = admin.firestore();
db.collection('app_config').doc('gemini').get().then(doc => {
  if (doc.exists) {
    console.log("Current Gemini config:", JSON.stringify(doc.data(), null, 2));
  } else {
    console.log("No app_config/gemini doc found");
  }
  process.exit(0);
}).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
