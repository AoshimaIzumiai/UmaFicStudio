/* HTML 实体回归：原始文本只能在最终 HTML sink 转义一次。 */
'use strict';

TestRunner.suite('Unicode 引号 — HTML 单次转义', (t) => {
  const quotedName = "O'Brien ‘Left’ D’Angelo";

  t.test('三种引号经escapeHtml写入DOM后应还原为原文', async () => {
    const host = document.createElement('div');
    const escaped = Utils.escapeHtml(quotedName);
    host.innerHTML = `<input value="${escaped}"><span>${escaped}</span>`;
    TestRunner.assert.equal(host.querySelector('input').value, quotedName);
    TestRunner.assert.equal(host.querySelector('span').textContent, quotedName);
    TestRunner.assert.ok(!host.textContent.includes('#39;'));
  });

  t.test('比赛结果重新加载不能显示&#39;s实体文本', async () => {
    await Storage.init();
    if (Storage.useLocalStorage) return;
    const suffix = Date.now();
    const horseId = `quote_horse_${suffix}`;
    const raceId = `quote_race_${suffix}`;
    const resultId = `quote_result_${suffix}`;
    const oldEntries = UIResults.currentEntries;
    const oldRace = UIResults.currentRace;
    const oldMode = UIResults.currentMode;
    const form = document.createElement('form');
    form.id = 'result-form';
    form.innerHTML = '<input name="year" value="2026">';
    document.body.appendChild(form);

    try {
      await Storage.put('horses', {
        id: horseId, name_en: quotedName, type: 'fictional', sex: 'male', birth_year: 2024,
      });
      await Storage.put('results', {
        id: resultId, race_id: raceId, year: 2026,
        entries: [{ horse_id: horseId, finish: 1 }],
      });
      UIResults.currentEntries = [];
      UIResults.currentRace = { id: raceId };
      UIResults.currentMode = 'template';

      await UIResults._loadExistingEntries();
      TestRunner.assert.equal(UIResults.currentEntries[0]._horse_name, `${quotedName}*`);
      TestRunner.assert.ok(!UIResults.currentEntries[0]._horse_name.includes('&#39;'));

      const host = document.createElement('div');
      host.innerHTML = UIResults._renderEntriesTable();
      const value = host.querySelector('#entry-horse-0').value;
      TestRunner.assert.equal(value, `${quotedName}*`);
      TestRunner.assert.ok(!value.includes('#39;'));
    } finally {
      UIResults.currentEntries = oldEntries;
      UIResults.currentRace = oldRace;
      UIResults.currentMode = oldMode;
      form.remove();
      await Storage.delete('results', resultId);
      await Storage.delete('horses', horseId);
    }
  });

  t.test('时间线名称不能把&#39;再次转义成可见文本', async () => {
    await Storage.init();
    if (Storage.useLocalStorage) return;
    const horseId = `quote_timeline_${Date.now()}`;
    const container = document.createElement('div');
    container.id = 'timeline-content';
    document.body.appendChild(container);
    try {
      await Storage.put('horses', {
        id: horseId, name_en: quotedName, type: 'fictional', sex: 'female', birth_year: 2025,
      });
      const events = await UITimeline._collectEvents();
      const event = events.find(item => item.text === `${quotedName}*`);
      TestRunner.assert.ok(event);
      TestRunner.assert.ok(!event.text.includes('&#39;'));
      UITimeline._render([event]);
      TestRunner.assert.ok(container.textContent.includes(`${quotedName}*`));
      TestRunner.assert.ok(!container.textContent.includes('#39;'));
    } finally {
      container.remove();
      await Storage.delete('horses', horseId);
    }
  });
});
