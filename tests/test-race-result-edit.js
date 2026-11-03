"use strict";

TestRunner.suite('赛事结果 — 保存后二次编辑回填', t => {
  t.test('adhoc赛事的等级、日程、场地、头数、条件、闸位和骑手应完整保留', async () => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    const dbName = `StudDataDB_RaceEdit_${Date.now()}_${crypto.randomUUID()}`;
    iframe.src = `race-result-edit-frame.html?db=${encodeURIComponent(dbName)}`;
    document.body.appendChild(iframe);
    let cleaned = false;
    try {
      await new Promise((resolve, reject) => {
        iframe.onload = resolve;
        iframe.onerror = () => reject(new Error('race result edit frame load failed'));
      });
      const result = await iframe.contentWindow.raceEditReady;
      const stored = result.stored;
      const form = result.form;
      const entry = stored.entry;

      TestRunner.assert.equal(result.useLocalStorage, false);
      TestRunner.assert.equal(result.dbVersion, 5);
      TestRunner.assert.equal(result.height_cm, 163.5);
      TestRunner.assert.equal(result.initialBodyWeightChange, '(-2)');
      TestRunner.assert.equal(result.editedBodyWeightChange, '(-2)');
      TestRunner.assert.deepEqual(result.bodyWeightSeries, ['480(0)', '490(+10)', '488(-2)']);
      TestRunner.assert.equal(stored.grade, '条件');
      TestRunner.assert.equal(stored.race_name, '隔离编辑测试赛');
      TestRunner.assert.equal(stored.year, 2026);
      TestRunner.assert.equal(stored.schedule, '9月第3周第7比赛日');
      TestRunner.assert.equal(stored.distance, 1800);
      TestRunner.assert.equal(stored.surface, 'dirt');
      TestRunner.assert.equal(stored.venue, '隔离竞马场');
      TestRunner.assert.equal(stored.runners, 12);
      TestRunner.assert.equal(stored.track_condition, 'heavy');
      TestRunner.assert.equal(stored.condition_note, '三岁以上');
      TestRunner.assert.equal(entry.jockey_id, result.jockeyId);
      TestRunner.assert.equal(entry.body_weight, 488);
      TestRunner.assert.equal(entry.gate, 7);

      TestRunner.assert.equal(form.grade, '条件');
      TestRunner.assert.equal(form.race_name, '隔离编辑测试赛');
      TestRunner.assert.equal(form.year, '2026');
      TestRunner.assert.equal(form.schedule_month, '9');
      TestRunner.assert.equal(form.schedule_week, '3');
      TestRunner.assert.equal(form.schedule_day, '7');
      TestRunner.assert.equal(result.limits.resultScheduleDayMax, '7');
      TestRunner.assert.equal(result.limits.templateSchedule.month, '10');
      TestRunner.assert.equal(result.limits.templateSchedule.week, '4');
      TestRunner.assert.equal(result.limits.templateSchedule.day, '7');
      TestRunner.assert.equal(result.limits.templateSchedule.dayMax, '7');
      TestRunner.assert.equal(form.distance, '1800');
      TestRunner.assert.equal(form.surface, 'dirt');
      TestRunner.assert.equal(form.venue, '隔离竞马场');
      TestRunner.assert.equal(form.runners, '12');
      TestRunner.assert.equal(form.track_condition, 'heavy');
      TestRunner.assert.equal(form.condition_note, '三岁以上');
      TestRunner.assert.equal(form.jockey_id, result.jockeyId);
      TestRunner.assert.equal(form.jockey_name, 'Race Edit Jockey');
      TestRunner.assert.equal(form.finish, '2');
      TestRunner.assert.equal(form.weight, '55');
      TestRunner.assert.equal(form.body_weight, '488');
      TestRunner.assert.equal(form.gate, '7');
      TestRunner.assert.equal(form.popularity, '3');
      TestRunner.assert.equal(form.prize, '123456');

      const cleanup = await iframe.contentWindow.cleanupRaceEditTest();
      TestRunner.assert.equal(cleanup.dbName, dbName);
      TestRunner.assert.equal(cleanup.deleted, true);
      cleaned = true;
    } finally {
      if (!cleaned) {
        try { await iframe.contentWindow.cleanupRaceEditTest(); } catch (_) {}
      }
      iframe.remove();
    }
  });
});
