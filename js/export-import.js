/* export-import.js — 导入导出逻辑 */
'use strict';

const ExportImport = {
  EXPORT_VERSION: '1.0',

  /**
   * 导出所有用户数据为 JSON 文件
   */
  async exportData() {
    const horses = await Storage.getAllHorses();
    const damGroups = await Storage.getAllGroups();

    const data = {
      export_version: this.EXPORT_VERSION,
      exported_at: Utils.formatDate(),
      horses,
      dam_groups: damGroups,
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
    // 写入马匹（覆盖 + 新增）
    for (const horse of (data.horses || [])) {
      await Storage.saveHorse(horse);
    }

    // 写入分组
    for (const group of (data.dam_groups || [])) {
      await Storage.saveGroup(group);
    }

    // 清除所有架空马的缓存（引用关系可能变化）
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
