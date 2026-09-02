const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gen-lang-client-08607869-461c2' });

const db = admin.firestore();

async function fixUrls() {
  const snapshot = await db.collection('Rondas').get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.evidences && data.evidences.length > 0) {
      let needsUpdate = false;
      const newEvidences = data.evidences.map(ev => {
        if (ev.photoUrl && ev.photoUrl.includes('ny.storage.bunnycdn.com/rondas-aspro-storage')) {
          needsUpdate = true;
          return {
            ...ev,
            photoUrl: ev.photoUrl.replace('https://ny.storage.bunnycdn.com/rondas-aspro-storage', 'https://rondas-aspro-storage.b-cdn.net')
          };
        }
        return ev;
      });

      if (needsUpdate) {
        await doc.ref.update({ evidences: newEvidences });
        console.log(`Updated doc ${doc.id}`);
        count++;
      }
    }
  }
  console.log(`Finished. Updated ${count} documents.`);
}

fixUrls().catch(console.error);
