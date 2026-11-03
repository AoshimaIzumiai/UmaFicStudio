"use strict";

TestRunner.suite('R9.4 — 旧功能CRUD与关联全链路', t => {
  t.test('架空马、人物、赛事、母系、谱系、配种与时间线应完整创建更新读取并清理', async () => {
    await Storage.init();
    if (Storage.useLocalStorage) throw new Error('R9.4 requires real IndexedDB');

    const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const ids = {
      country: `cty_r9_${suffix}`,
      farm: `farm_r9_${suffix}`,
      trainer: `trn_r9_${suffix}`,
      owner: `own_r9_${suffix}`,
      jockey: `jky_r9_${suffix}`,
      race: `race_r9_${suffix}`,
      result: `result_r9_${suffix}`,
      group: `group_r9_${suffix}`,
      common: `horse_common_${suffix}`,
      sire: `horse_sire_${suffix}`,
      dam: `horse_dam_${suffix}`,
      foal: `horse_foal_${suffix}`,
    };
    const entityStores = [
      ['countries', ids.country], ['farms', ids.farm], ['trainers', ids.trainer],
      ['owners', ids.owner], ['jockeys', ids.jockey], ['races', ids.race],
      ['results', ids.result],
    ];
    const horseIds = [ids.common, ids.sire, ids.dam, ids.foal];

    try {
      await Storage.saveEntity('countries', {
        id: ids.country, name_cn: 'R9测试国', name_en: 'R9 Testland', code: `R${suffix.slice(-2)}`,
        custom_grades: 'S1\nS2', venues: '测试竞马场', source: 'user',
      });
      await Storage.saveEntity('farms', {
        id: ids.farm, name: 'R9测试牧场', country_id: ids.country, location: '北区',
      });
      await Storage.saveEntity('trainers', {
        id: ids.trainer, name: 'R9练马师', country_id: ids.country, stable: '中央',
      });
      await Storage.saveEntity('owners', {
        id: ids.owner, name: 'R9马主', country_id: ids.country, prefix: 'R9',
      });
      await Storage.saveEntity('jockeys', {
        id: ids.jockey, name: 'R9骑手', country_id: ids.country, region: '中央', sex: '女',
      });

      await Storage.saveHorse({
        id: ids.common, type: 'fictional', name_en: 'R9 Common Ancestor',
        sex: 'male', role: 'stallion', birth_year: 1990, country: 'R9',
      });
      await Storage.saveHorse({
        id: ids.sire, type: 'fictional', name_en: 'R9 Test Sire',
        sex: 'male', role: 'stallion', birth_year: 2010, country: 'R9',
        sire_id: ids.common, farm: ids.farm, owner: ids.owner,
      });
      await Storage.saveHorse({
        id: ids.dam, type: 'fictional', name_en: 'R9 Test Dam',
        sex: 'female', role: 'broodmare', birth_year: 2011, country: 'R9',
        sire_id: ids.common, farm: ids.farm, owner: ids.owner,
      });
      await Storage.saveHorse({
        id: ids.foal, type: 'fictional', name_en: 'R9 Full Chain Horse',
        name_ja: 'R9総合試験馬', sex: 'female', role: 'active', birth_year: 2024,
        country: 'R9', sire_id: ids.sire, dam_id: ids.dam,
        farm: ids.farm, trainer: ids.trainer, owner: ids.owner,
        aptitude_surface: ['turf'], distance_min: 1600, distance_max: 2400,
        career_events: [{ year: 2030, type: 'retired', note: 'R9退役确认' }],
      });
      await Storage.saveGroup({
        id: ids.group, name: 'R9母系族群', root_mare_id: ids.dam,
        horse_ids: [ids.dam, ids.foal], notes: 'R9完整关联',
      });
      await Storage.saveEntity('races', {
        id: ids.race, country_id: ids.country, name: 'R9 Integration Stakes',
        name_cn: 'R9综合锦标', grade: 'S1', venue: '测试竞马场',
        distance: 2000, surface: 'turf', schedule: '5月第2周第1比赛日',
      });
      await Storage.saveEntity('results', {
        id: ids.result, race_id: ids.race, year: 2026,
        schedule: '5月第2周第1比赛日', race_name: 'R9综合锦标', grade: 'S1',
        venue: '测试竞马场', distance: 2000, surface: 'turf',
        entries: [{ horse_id: ids.foal, jockey_id: ids.jockey, finish: 1, time: '2:00.0' }],
      });

      const foal = await Storage.getHorse(ids.foal);
      TestRunner.assert.equal(foal.owner, ids.owner);
      TestRunner.assert.equal(foal.trainer, ids.trainer);
      TestRunner.assert.equal(foal.farm, ids.farm);
      TestRunner.assert.equal((await Storage.getGroup(ids.group)).root_mare_id, ids.dam);
      TestRunner.assert.equal((await Storage.getEntity('races', ids.race)).country_id, ids.country);
      TestRunner.assert.equal((await Storage.getEntity('results', ids.result)).entries[0].jockey_id, ids.jockey);

      const sireChildren = await Storage.findHorsesReferencing(ids.sire);
      TestRunner.assert.ok(sireChildren.some(horse => horse.id === ids.foal));
      const countryRaces = await Storage.getAllByIndex('races', 'country_id', ids.country);
      TestRunner.assert.ok(countryRaces.some(race => race.id === ids.race));

      const pedigree = await Pedigree.getPedigreeTree(ids.foal);
      TestRunner.assert.equal(pedigree.sire.id, ids.sire);
      TestRunner.assert.equal(pedigree.dam.id, ids.dam);
      TestRunner.assert.equal(pedigree.sire.sire.id, ids.common);
      TestRunner.assert.equal(pedigree.dam.sire.id, ids.common);
      const completeness = Pedigree.checkCompleteness(pedigree);
      TestRunner.assert.deepEqual(completeness.gen1, { filled: 2, total: 2, percent: 100 });
      TestRunner.assert.deepEqual(completeness.gen2, { filled: 2, total: 4, percent: 50 });

      const mating = await Cross.simulateMating(ids.sire, ids.dam);
      TestRunner.assert.equal(mating.tree.sire.id, ids.sire);
      TestRunner.assert.equal(mating.tree.dam.id, ids.dam);
      const commonCross = mating.crossResult.crosses.find(cross => cross.ancestor_key === ids.common);
      TestRunner.assert.ok(commonCross);
      TestRunner.assert.deepEqual(commonCross.positions, { sire_side: [2], dam_side: [2] });
      TestRunner.assert.equal(commonCross.blood_percentage, 50);

      const events = await UITimeline._collectEvents();
      const relatedEvents = events.filter(event => event.text.includes('R9 Full Chain Horse'));
      TestRunner.assert.ok(relatedEvents.some(event => event.year === 2024 && event.type === 'birth'));
      TestRunner.assert.ok(relatedEvents.some(event => event.year === 2026 && event.type === 'debut' && event.detail.includes('第1名')));
      TestRunner.assert.ok(relatedEvents.some(event => event.year === 2030 && event.type === 'retired'));

      const foalToUpdate = await Storage.getHorse(ids.foal);
      foalToUpdate.notes = 'R9更新后备注';
      foalToUpdate.role = 'retired';
      await Storage.saveHorse(foalToUpdate);
      const updatedFoal = await Storage.getHorse(ids.foal);
      TestRunner.assert.equal(updatedFoal.notes, 'R9更新后备注');
      TestRunner.assert.equal(updatedFoal.role, 'retired');

      const sire = await Storage.getHorse(ids.sire);
      sire.name_en = 'R9 Test Sire Updated';
      await Storage.saveHorse(sire);
      await Pedigree.onHorseUpdated(ids.sire);
      TestRunner.assert.equal((await Storage.getHorse(ids.foal)).pedigree_cache, null);
    } finally {
      await Storage._deleteRaw('results', ids.result);
      await Storage._deleteRaw('races', ids.race);
      await Storage._deleteRaw('dam_groups', ids.group);
      for (const horseId of horseIds.reverse()) await Storage._deleteRaw('horses', horseId);
      for (const [store, id] of entityStores.slice(0, 5).reverse()) {
        await Storage._deleteRaw(store, id);
      }
      TestRunner.assert.equal(await Storage.getHorse(ids.foal), null);
      TestRunner.assert.equal(await Storage.getGroup(ids.group), null);
      TestRunner.assert.equal(await Storage.getEntity('results', ids.result), null);
      TestRunner.assert.equal(await Storage.getEntity('races', ids.race), null);
      TestRunner.assert.equal(await Storage.getEntity('countries', ids.country), null);
    }
  });

  t.test('非broodmare角色的母马只要被dam_id引用，详情也必须显示产驹', async () => {
    await Storage.init();
    if (Storage.useLocalStorage) throw new Error('dam progeny regression requires IndexedDB');
    const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const damId = `bug_dam_${suffix}`;
    const foalId = `bug_foal_${suffix}`;
    try {
      await Storage.saveHorse({
        id: damId, type: 'fictional', name_en: 'Reported Retired Dam',
        sex: 'female', role: 'retired', birth_year: 2012,
      });
      await Storage.saveHorse({
        id: foalId, type: 'fictional', name_en: 'Dam Linked Foal',
        sex: 'male', role: 'active', birth_year: 2025, dam_id: damId,
      });

      const dam = await Storage.getHorse(damId);
      TestRunner.assert.equal(dam.role, 'retired');
      const html = await UIPedigree._renderProgeny(dam);
      const host = document.createElement('div');
      host.innerHTML = html;
      TestRunner.assert.ok(host.textContent.includes('Dam Linked Foal'));
      TestRunner.assert.ok(host.textContent.includes('1'));
      TestRunner.assert.equal(host.querySelectorAll('tbody tr').length, 1);
      TestRunner.assert.equal((await Storage.getHorse(foalId)).dam_id, damId);
    } finally {
      await Storage._deleteRaw('horses', foalId);
      await Storage._deleteRaw('horses', damId);
    }
  });
});
