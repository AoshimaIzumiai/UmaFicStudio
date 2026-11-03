"use strict";

const R8ImportHelpers = {
  async clearOutbox(userId) {
    for (const item of await Storage.getAll("sync_outbox")) {
      if (item.user_id === userId) await Storage.removeFromOutbox(userId, item.op_id);
    }
  },
  async removeRecords(records) {
    for (const [module, id] of records) await Storage._deleteRaw(module, id);
  },
};

TestRunner.suite("R8.9 — export_version 1.3 JSON与过滤", t => {
  t.test("导出只生成一个可重新导入JSON并排除preset、Press", async () => {
    const stamp = Date.now();
    const ids = {
      horse: `export_horse_${stamp}`,
      race: `export_race_${stamp}`,
      result: `export_result_${stamp}`,
      preset: `export_preset_${stamp}`,
      press: `export_press_${stamp}`,
    };
    const previousOwner = Storage.getWorkspaceOwner();
    let capturedBlob = null;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    try {
      await Storage.setWorkspaceOwner(null);
      await Storage._putRaw("horses", {
        id: ids.horse, name_en: "Export Horse", type: "fictional", height_cm: 163.5,
      });
      await Storage._putRaw("races", {
        id: ids.race, name: "User Race", source: "user",
      });
      await Storage._putRaw("results", {
        id: ids.result, race_id: ids.race, year: 2026,
        entries: [{ horse_id: ids.horse, finish: 1, body_weight: 488 }],
      });
      await Storage._putRaw("races", {
        id: ids.preset, name: "Built-in Race", source: "preset",
      });
      await Storage._putRaw("press_articles", {
        id: ids.press, title: "Local Press", markdown: "# local",
      });

      URL.createObjectURL = blob => { capturedBlob = blob; return "blob:r8-export"; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function() {};
      await ExportImport.exportData();
      TestRunner.assert.ok(capturedBlob instanceof Blob);
      const exported = JSON.parse(await capturedBlob.text());
      TestRunner.assert.equal(exported.export_version, "1.3");
      TestRunner.assert.equal(exported.horses.filter(item => item.id === ids.horse).length, 1);
      TestRunner.assert.equal(exported.horses.find(item => item.id === ids.horse).height_cm, 163.5);
      TestRunner.assert.equal(exported.results.find(item => item.id === ids.result).entries[0].body_weight, 488);
      TestRunner.assert.equal(exported.races.filter(item => item.id === ids.race).length, 1);
      TestRunner.assert.equal(exported.races.filter(item => item.id === ids.preset).length, 0);
      TestRunner.assert.equal(Object.prototype.hasOwnProperty.call(exported, "press_articles"), false);
      TestRunner.assert.equal(document.querySelectorAll('a[download^="studdata_export_"]').length, 0);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
      await R8ImportHelpers.removeRecords([
        ["horses", ids.horse], ["races", ids.race], ["results", ids.result],
        ["races", ids.preset], ["press_articles", ids.press],
      ]);
      await Storage.setWorkspaceOwner(previousOwner);
    }
  });

  t.test("1.3 JSON导入迁移人物引用且不覆盖preset或导入Press/config", async () => {
    const stamp = Date.now();
    const userId = `import_user_${stamp}`;
    const previousOwner = Storage.getWorkspaceOwner();
    const ids = {
      horse: `import_horse_${stamp}`,
      farm: `farm_import_${stamp}`,
      trainer: `trn_import_${stamp}`,
      owner: `own_import_${stamp}`,
      country: `country_import_${stamp}`,
      race: `race_import_${stamp}`,
      result: `result_import_${stamp}`,
      preset: `preset_import_${stamp}`,
      press: `press_import_${stamp}`,
    };
    try {
      await Storage.setWorkspaceOwner(userId);
      await Storage._putRaw("races", {
        id: ids.preset, name: "Official Preset", source: "preset",
      });
      await Storage._putRaw("press_articles", {
        id: ids.press, title: "Existing Local Press", markdown: "keep",
      });
      const data = {
        export_version: "1.3",
        exported_at: "2026-08-30T12:00:00Z",
        horses: [{
          id: ids.horse,
          name_en: "Imported Horse",
          type: "fictional",
          farm: `Farm Name ${stamp}`,
          trainer: `Trainer Name ${stamp}`,
          owner: `Owner Name ${stamp}`,
          height_cm: 162.8,
          pedigree_cache: { stale: true },
        }],
        dam_groups: [],
        farms: [{ id: ids.farm, name: `Farm Name ${stamp}` }],
        trainers: [{ id: ids.trainer, name: `Trainer Name ${stamp}` }],
        owners: [{ id: ids.owner, name: `Owner Name ${stamp}` }],
        countries: [{ id: ids.country, name: "User Country", source: "user" }],
        jockeys: [],
        races: [
          { id: ids.race, name: "User Imported Race", source: "user", country_id: ids.country },
          { id: ids.preset, name: "Malicious Preset Override", source: "preset" },
        ],
        results: [{
          id: ids.result, race_id: ids.race,
          entries: [{ horse_id: ids.horse, finish: 1, body_weight: 476 }],
        }],
        press_articles: [{ id: ids.press, title: "Must Not Import" }],
        config: { should_not_apply: true },
      };
      const file = new File([JSON.stringify(data)], "umafic-1.3.json", {
        type: "application/json",
      });
      const preview = await ExportImport.importData(file);
      TestRunner.assert.equal(preview.newCount, 1);
      TestRunner.assert.equal(preview.data.races.length, 1);
      await ExportImport.confirmImport(preview.data);

      const horse = await Storage.getHorse(ids.horse);
      TestRunner.assert.equal(horse.farm, ids.farm);
      TestRunner.assert.equal(horse.trainer, ids.trainer);
      TestRunner.assert.equal(horse.owner, ids.owner);
      TestRunner.assert.equal(horse.height_cm, 162.8);
      TestRunner.assert.equal((await Storage.get('results', ids.result)).entries[0].body_weight, 476);
      TestRunner.assert.equal(horse.pedigree_cache, null);
      TestRunner.assert.equal((await Storage.get("races", ids.preset)).name, "Official Preset");
      TestRunner.assert.equal((await Storage.getPressArticle(ids.press)).title, "Existing Local Press");
      TestRunner.assert.equal(await Storage.get("config", "should_not_apply"), null);
      const outbox = (await Storage.getAll("sync_outbox")).filter(item => item.user_id === userId);
      TestRunner.assert.ok(outbox.some(item => item.record_id === ids.horse));
      TestRunner.assert.ok(outbox.some(item => item.record_id === ids.race));
      TestRunner.assert.ok(!outbox.some(item => item.record_id === ids.preset));
      TestRunner.assert.ok(!outbox.some(item => item.module === "press_articles"));
    } finally {
      await R8ImportHelpers.clearOutbox(userId);
      await R8ImportHelpers.removeRecords([
        ["horses", ids.horse], ["farms", ids.farm], ["trainers", ids.trainer],
        ["owners", ids.owner], ["countries", ids.country], ["races", ids.race],
        ["results", ids.result], ["races", ids.preset], ["press_articles", ids.press],
      ]);
      await Storage.setWorkspaceOwner(previousOwner);
    }
  });
});

TestRunner.suite("R8.9 — 名片码完整导入", t => {
  t.test("Unicode马匹、战绩和血统经格式化名片码导入后引用新ID", async () => {
    const stamp = Date.now();
    const userId = `share_user_${stamp}`;
    const previousOwner = Storage.getWorkspaceOwner();
    const originalAlert = window.alert;
    let importedHorse = null;
    const resultIds = [];
    try {
      await Storage.setWorkspaceOwner(userId);
      const sourceHorse = {
        id: `source_${stamp}`,
        name_en: "Hikari",
        name_ja: "光の馬",
        name_cn: "光之马",
        type: "fictional",
        sex: "female",
        birth_year: 2024,
        height_cm: 161.7,
        notes: "Unicode 🐎 ‘quoted’",
        career_events: [{ year: 2026, type: "debut", note: "初战" }],
      };
      const results = [{
        id: `source_result_${stamp}`,
        race_name: "夏季大奖赛",
        year: 2026,
        entries: [{ horse_id: sourceHorse.id, finish: 1, time: "2:01.3", body_weight: 482 }],
      }];
      const pedigree = {
        id: "root", name_en: "Root", country: "JP",
        sire: { id: "sire", name_en: "Sire", country: "US", sire: null, dam: null },
        dam: { id: "dam", name_en: "Dam", country: "JP", sire: null, dam: null },
      };
      const code = await ShareCard.encode(sourceHorse, results, pedigree);
      const formatted = code.replace("UMA1:", "UMA1：\u200B")
        .replace(/(.{64})/g, "$1\n");
      const decoded = await ShareCard.decode(formatted);
      TestRunner.assert.equal(decoded.error, undefined);
      TestRunner.assert.equal(decoded.horse.name_ja, "光の馬");
      TestRunner.assert.equal(decoded.horse.height_cm, 161.7);
      TestRunner.assert.equal(decoded.results[0].entries[0].body_weight, 482);
      TestRunner.assert.equal(decoded.results[0].race_name, "夏季大奖赛");
      TestRunner.assert.equal(decoded.pedigree.sire.name_en, "Sire");

      window.alert = () => {};
      ShareCard._pendingImport = decoded;
      await ShareCard._doImport();
      importedHorse = await Storage.getHorse(decoded.horse.id);
      TestRunner.assert.ok(importedHorse);
      TestRunner.assert.equal(importedHorse.type, "shared");
      TestRunner.assert.equal(importedHorse.height_cm, 161.7);
      TestRunner.assert.equal(importedHorse.pedigree_cache.sire.name_en, "Sire");
      const allResults = await Storage.getAll("results");
      const importedResults = allResults.filter(result =>
        (result.entries || []).some(entry => entry.horse_id === importedHorse.id)
      );
      TestRunner.assert.equal(importedResults.length, 1);
      TestRunner.assert.equal(importedResults[0].entries[0].body_weight, 482);
      TestRunner.assert.ok(importedResults[0].entries.every(
        entry => !entry.horse_id || entry.horse_id === importedHorse.id
      ));
      resultIds.push(...importedResults.map(result => result.id));
      const outbox = (await Storage.getAll("sync_outbox")).filter(item => item.user_id === userId);
      TestRunner.assert.ok(outbox.some(item => item.record_id === importedHorse.id));
      TestRunner.assert.ok(outbox.some(item => resultIds.includes(item.record_id)));
    } finally {
      window.alert = originalAlert;
      ShareCard._pendingImport = null;
      await R8ImportHelpers.clearOutbox(userId);
      if (importedHorse) await Storage._deleteRaw("horses", importedHorse.id);
      for (const id of resultIds) await Storage._deleteRaw("results", id);
      await Storage.setWorkspaceOwner(previousOwner);
    }
  });
});
