"use strict";

TestRunner.suite('年份规则 — 同母同年最多两匹且必须同父', t => {
  t.test('首匹、同父第二匹、异父/无父第二匹、第三匹及编辑边界', async () => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    const dbName = `StudDataDB_FoalRule_${Date.now()}_${crypto.randomUUID()}`;
    iframe.src = `foal-year-rule-frame.html?db=${encodeURIComponent(dbName)}`;
    document.body.appendChild(iframe);
    let cleaned = false;
    try {
      await new Promise((resolve, reject) => {
        iframe.onload = resolve;
        iframe.onerror = () => reject(new Error('foal rule frame load failed'));
      });
      const result = await iframe.contentWindow.foalRuleReady;
      TestRunner.assert.equal(result.useLocalStorage, false);
      TestRunner.assert.equal(result.dbVersion, 5);
      TestRunner.assert.equal(result.firstCheck.errors.length, 0);
      TestRunner.assert.equal(result.firstCheck.confirmations.length, 0);
      TestRunner.assert.equal(result.secondSameSire.errors.length, 0);
      TestRunner.assert.equal(result.secondSameSire.confirmations.length, 1);
      TestRunner.assert.ok(result.secondSameSire.confirmations[0].includes('是否将两匹设定为双胞胎？'));
      TestRunner.assert.equal(result.secondSameSireFree.errors.length, 0);
      TestRunner.assert.equal(result.secondSameSireFree.confirmations.length, 1);
      TestRunner.assert.ok(result.secondDifferentSire.errors.some(message => message.includes('相同的父亲')));
      TestRunner.assert.equal(result.secondDifferentFree.errors.length, 0);
      TestRunner.assert.ok(result.secondDifferentFree.warnings.some(message => message.includes('相同的父亲')));
      TestRunner.assert.ok(result.secondMissingSire.errors.some(message => message.includes('必须填写')));
      TestRunner.assert.ok(result.thirdStrict.errors.some(message => message.includes('每年最多2匹')));
      TestRunner.assert.equal(result.editFirstSameSire.errors.length, 0);
      TestRunner.assert.equal(result.editFirstSameSire.confirmations.length, 0);
      TestRunner.assert.ok(result.editFirstDifferentSire.errors.some(message => message.includes('相同的父亲')));
      TestRunner.assert.equal(result.thirdFree.errors.length, 0);
      TestRunner.assert.ok(result.thirdFree.warnings.some(message => message.includes('每年最多2匹')));
      const cleanup = await iframe.contentWindow.cleanupFoalRuleTest();
      TestRunner.assert.equal(cleanup.dbName, dbName);
      TestRunner.assert.equal(cleanup.deleted, true);
      cleaned = true;
    } finally {
      if (!cleaned) {
        try { await iframe.contentWindow.cleanupFoalRuleTest(); } catch (_) {}
      }
      iframe.remove();
    }
  });
});
