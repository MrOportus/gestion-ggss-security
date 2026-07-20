const admin = require('firebase-admin');

// Ensure we don't initialize multiple times
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'gen-lang-client-08607869-461c2'
  });
}

const db = admin.firestore();

async function run() {
  try {
    console.log("Querying Asistencia to find recent siteIds...");
    const snapshot = await db.collection('Asistencia')
                             .orderBy('timestamp', 'desc')
                             .limit(10)
                             .get();
    
    if (snapshot.empty) {
      console.log('No matching documents found in Asistencia.');
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Doc ID: ${doc.id}`);
      console.log(`siteId: ${data.siteId} (Type: ${typeof data.siteId})`);
      console.log(`employeeId: ${data.employeeId}`);
      console.log('---');
    });

  } catch (error) {
    console.error("Error querying Firestore:", error);
  }
}

run();
