/* 血统模拟搜索回归：同前缀史实马不能被8条硬截断遗漏。 */
'use strict';

TestRunner.suite('血统模拟 — 史实种马搜索', (t) => {
  t.test('真实索引用 Mejiro 应找到 Mejiro Ryan', async () => {
    const originalIndex = DataLoader.index;
    const originalUsers = UISimulate._cachedUserHorses;
    try {
      const response = await fetch('../data/stallions_index.json');
      TestRunner.assert.ok(response.ok);
      DataLoader.index = await response.json();
      UISimulate._cachedUserHorses = [];
      const results = UISimulate._searchStallions('Mejiro');
      TestRunner.assert.ok(results.some(h => h.id === '0000201489'));
    } finally {
      DataLoader.index = originalIndex;
      UISimulate._cachedUserHorses = originalUsers;
    }
  });

  t.test('Mejiro 前缀应包含原索引第9匹 Mejiro Ryan', async () => {
    const originalIndex = DataLoader.index;
    const originalUsers = UISimulate._cachedUserHorses;
    try {
      const names = [
        'Mejiro Bailey', 'Mejiro Daibosatsu', 'Mejiro Ardan',
        'Mejiro Bright', 'Mejiro Delhi', 'Mejiro Desire',
        'Mejiro McQueen', 'Mejiro Palmer', 'Mejiro Ryan',
        'Mejiro Titan', 'Mejiro Musashi', 'Mejiro Espada',
        'Mejiro Eagle', 'Mejiro Mont Cenis', 'Mejiro Rikuzen',
        'Mejiro Asama', 'Mejiro Samman', 'Mejiro Jizo',
        'Mejiro Zaniah', 'Mejiro Seaton', 'Mejiro Henry',
        'Mejiro Durren', 'Mejiro Eiger', 'Mejiro Maskette',
        'Mejiro Goshawk',
      ];
      DataLoader.index = {
        horses: names.map((name, index) => ({
          id: name === 'Mejiro Ryan' ? '0000201489' : `mejiro_${index}`,
          name_en: name,
          name_ja: name === 'Mejiro Ryan' ? 'メジロライアン' : '',
          name_cn: name === 'Mejiro Ryan' ? '目白韋仁' : '',
          sex: 'male',
        })),
      };
      UISimulate._cachedUserHorses = [];


      const results = UISimulate._searchStallions('Mejiro');
      TestRunner.assert.equal(results.length, 25);
      TestRunner.assert.ok(results.some(h => h.id === '0000201489'));
      TestRunner.assert.equal(UISimulate._searchStallions('Ryan')[0].id, '0000201489');
      TestRunner.assert.equal(UISimulate._searchStallions('目白韋仁')[0].id, '0000201489');
    } finally {
      DataLoader.index = originalIndex;
      UISimulate._cachedUserHorses = originalUsers;
    }
  });

  t.test('Sea The Stars应唯一收录并显示2010-2026官方供用区间', async () => {
    const originalIndex = DataLoader.index;
    const originalUsers = UISimulate._cachedUserHorses;
    const originalCache = DataLoader.pedigreeCache;
    const originalLoaded = DataLoader._loadedShards;
    const originalBaseUrl = DataLoader._baseUrl;
    try {
      const response = await fetch('../data/stallions_index.json');
      TestRunner.assert.ok(response.ok);
      const index = await response.json();
      const matches = index.horses.filter(h => h.id === '0001113706');
      TestRunner.assert.equal(matches.length, 1);
      const horse = matches[0];
      TestRunner.assert.equal(horse.name_en, 'Sea The Stars');
      TestRunner.assert.equal(horse.name_cn, '海都之星');
      TestRunner.assert.equal(horse.birth_year, 2006);
      TestRunner.assert.equal(horse.sire_id, '0000363470');
      TestRunner.assert.equal(horse.stud_year_start, 2010);
      TestRunner.assert.equal(horse.stud_year_end, 2026);
      TestRunner.assert.equal(horse.stud_year_source, 'aga_khan_studs_2026');
      TestRunner.assert.deepEqual(horse.aptitude_surface, ['turf']);
      TestRunner.assert.equal(index.count, index.horses.length);

      DataLoader.index = index;
      DataLoader.pedigreeCache = {};
      DataLoader._loadedShards = new Set();
      DataLoader._baseUrl = '../';
      UISimulate._cachedUserHorses = [];
      const searchMatches = UISimulate._searchStallions('Sea The Stars')
        .filter(h => h.id === '0001113706');
      TestRunner.assert.equal(searchMatches.length, 1);
      const pedigree = await DataLoader.loadPedigree('0001113706');
      TestRunner.assert.equal(pedigree.sire.name_en, 'Cape Cross');
      TestRunner.assert.equal(pedigree.dam.name_en, 'Urban Sea');
    } finally {
      DataLoader.index = originalIndex;
      DataLoader.pedigreeCache = originalCache;
      DataLoader._loadedShards = originalLoaded;
      DataLoader._baseUrl = originalBaseUrl;
      UISimulate._cachedUserHorses = originalUsers;
    }
  });

  t.test('宽泛查询最多渲染30项', async () => {
    const originalIndex = DataLoader.index;
    const originalUsers = UISimulate._cachedUserHorses;
    try {
      DataLoader.index = {
        horses: Array.from({ length: 50 }, (_, index) => ({
          id: `common_${index}`,
          name_en: `Common Stallion ${index}`,
          name_ja: '',
          sex: 'male',
        })),
      };
      UISimulate._cachedUserHorses = [];
      TestRunner.assert.equal(UISimulate._searchStallions('Common').length, 30);
    } finally {
      DataLoader.index = originalIndex;
      UISimulate._cachedUserHorses = originalUsers;
    }
  });
});
