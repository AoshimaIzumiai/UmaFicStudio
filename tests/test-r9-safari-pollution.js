"use strict";

TestRunner.suite('R9.1 — Safari真实IndexedDB污染恢复隔离', t => {
  t.test('全新隔离DB备份→删库→v5重建应恢复业务、Press、outbox和cursor且移除ped污染', async () => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    const dbName = `StudDataDB_Safari_Pollution_${Date.now()}_${crypto.randomUUID()}`;
    iframe.src = `safari-pollution-frame.html?db=${encodeURIComponent(dbName)}`;
    document.body.appendChild(iframe);
    let cleaned = false;
    try {
      await new Promise((resolve, reject) => {
        iframe.onload = resolve;
        iframe.onerror = () => reject(new Error('pollution frame load failed'));
      });
      const result = await iframe.contentWindow.pollutionReady;
      TestRunner.assert.equal(result.useLocalStorage, false);
      TestRunner.assert.equal(result.dbVersion, 5);
      TestRunner.assert.equal(result.horse.name_en, 'Safari Preserved Horse');
      TestRunner.assert.equal(result.press.title, 'Safari Preserved Press');
      TestRunner.assert.equal(result.outbox.user_id, result.testUser);
      TestRunner.assert.equal(result.outbox.record_id, result.horseId);
      TestRunner.assert.equal(result.owner.value, result.testUser);
      TestRunner.assert.equal(result.cursor.value, 77);
      TestRunner.assert.equal(result.generation.value, 4);
      TestRunner.assert.equal(result.safeConfig.value, 'strict');
      TestRunner.assert.equal(result.contamination, null);
      TestRunner.assert.equal(result.purgeDone, '1');
      TestRunner.assert.equal(result.backupPayload, null);
      TestRunner.assert.equal(result.backupMarker, null);
      const cleanup = await iframe.contentWindow.cleanupPollutionTest();
      TestRunner.assert.equal(cleanup.dbName, dbName);
      TestRunner.assert.equal(cleanup.deleted, true);
      cleaned = true;
    } finally {
      if (!cleaned) {
        try { await iframe.contentWindow.cleanupPollutionTest(); } catch (_) {}
      }
      iframe.remove();
    }
  });
});
