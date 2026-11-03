'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const dam = {
    id: 'dam_retired', type: 'fictional', name_en: 'Retired Dam',
    sex: 'female', role: 'retired', birth_year: 2012,
  };
  const foal = {
    id: 'foal_linked', type: 'fictional', name_en: 'Linked Foal',
    sex: 'male', role: 'active', birth_year: 2025, dam_id: dam.id,
  };
  const calls = { results: 0 };
  const context = {
    console,
    Storage: {
      async getAllHorses() { return [dam, foal]; },
      async getAllEntities(store) {
        assert.equal(store, 'results');
        calls.results += 1;
        return [];
      },
    },
    Pedigree: { async _findHorse() { return null; } },
    Utils: {
      safeDisplayName(horse) { return horse.name_en; },
      sexLabel(sex) { return sex; },
    },
    I18N: {
      t(key) {
        return {
          progenyRecord: '产驹成绩', progenyCount: '产驹数', noProgeny: '暂无产驹',
          nameEn: '马名', sex: '性别', birthYear: '出生年',
        }[key] || key;
      },
    },
  };
  vm.createContext(context);
  const sourcePath = path.join(__dirname, '..', 'js', 'ui-pedigree.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInContext(`${source}\n;globalThis.__UIPedigree = UIPedigree;`, context, {
    filename: sourcePath,
  });

  const html = await context.__UIPedigree._renderProgeny(dam);
  assert.match(html, /Linked Foal/);
  assert.match(html, /产驹数[^<]*：1/);
  assert.equal((html.match(/<tbody>/g) || []).length, 1);
  assert.equal(dam.role, 'retired');
  assert.equal(foal.dam_id, dam.id);
  assert.equal(calls.results, 1);

  const unrelated = {
    id: 'unrelated', type: 'fictional', name_en: 'Unrelated',
    sex: 'female', role: 'retired',
  };
  context.Storage.getAllHorses = async () => [unrelated];
  const empty = await context.__UIPedigree._renderProgeny(unrelated);
  assert.equal(empty, '');
  assert.equal(calls.results, 1, '无产驹普通马不应读取全部比赛结果');

  console.log('dam_progeny_role_regression=passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
