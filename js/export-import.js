/* export-import.js — 导入导出逻辑 */
'use strict';

const ExportImport = {
  EXPORT_VERSION: '1.3',

  /**
   * 导出所有用户数据为 JSON 文件
   */
  async exportData() {
    const horses = await Storage.getAllHorses();
    const damGroups = await Storage.getAllGroups();
    const farms = await Storage.getAllEntities('farms');
    const trainers = await Storage.getAllEntities('trainers');
    const owners = await Storage.getAllEntities('owners');
    const countries = await Storage.getAllEntities('countries');
    const jockeys = await Storage.getAllEntities('jockeys');
    const races = await Storage.getAllEntities('races');
    const results = await Storage.getAllEntities('results');

    const data = {
      export_version: this.EXPORT_VERSION,
      exported_at: Utils.formatDate(),
      horses,
      dam_groups: damGroups,
      farms,
      trainers,
      owners,
      countries,
      jockeys,
      races,
      results,
      config: {}
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `studdata_export_${Utils.formatDateShort()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[Export] 已导出 ${horses.length} 匹马, ${damGroups.length} 个分组`);
  },

  /**
   * 导入 JSON 文件
   * @param {File} file
   * @returns {Promise<{newCount, overwriteCount}>}
   */
  async importData(file) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('文件格式错误：不是有效的 JSON');
    }

    if (!data.export_version) {
      throw new Error('文件格式错误：缺少 export_version 字段');
    }

    // 统计差异
    const existingHorses = await Storage.getAllHorses();
    const existingIds = new Set(existingHorses.map(h => h.id));

    const newHorses = (data.horses || []).filter(h => !existingIds.has(h.id));
    const overwriteHorses = (data.horses || []).filter(h => existingIds.has(h.id));

    return {
      newCount: newHorses.length,
      overwriteCount: overwriteHorses.length,
      groupCount: (data.dam_groups || []).length,
      data
    };
  },

  /**
   * 确认导入后执行写入
   * @param {object} data - 已解析的导入数据
   */
  async confirmImport(data) {
    for (const horse of (data.horses || [])) {
      await Storage.saveHorse(horse);
    }
    for (const group of (data.dam_groups || [])) {
      await Storage.saveGroup(group);
    }
    // 导入实体数据（v1.2+）
    for (const farm of (data.farms || [])) {
      await Storage.saveEntity('farms', farm);
    }
    for (const trainer of (data.trainers || [])) {
      await Storage.saveEntity('trainers', trainer);
    }
    for (const owner of (data.owners || [])) {
      await Storage.saveEntity('owners', owner);
    }
    // 导入赛事系统数据（v1.3+）
    for (const country of (data.countries || [])) {
      await Storage.saveEntity('countries', country);
    }
    for (const jockey of (data.jockeys || [])) {
      await Storage.saveEntity('jockeys', jockey);
    }
    for (const race of (data.races || [])) {
      await Storage.saveEntity('races', race);
    }
    for (const result of (data.results || [])) {
      await Storage.saveEntity('results', result);
    }
    // 处理旧版马匹文本字段
    await Storage.migrateEntityReferences();
    // 清除缓存
    const allHorses = await Storage.getAllHorses();
    for (const horse of allHorses) {
      if (horse.pedigree_cache) {
        horse.pedigree_cache = null;
        await Storage.saveHorse(horse);
      }
    }
    console.log(`[Import] 导入完成`);
  }
};
