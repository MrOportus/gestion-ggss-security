const admin = require('firebase-admin');
const path = require('path');
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

const db = admin.firestore();
db.collection('app_config').doc('version').get().then(doc => {
  if (doc.exists) {
    console.log("Current DB Version config:", doc.data());
  } else {
    console.log("No version doc found");
  }
  process.exit(0);
}).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
