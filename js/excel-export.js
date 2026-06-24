/* excel-export.js — 架空马数据导出为 Excel */
const ExcelExport = {

  async exportAll() {
    const horses = await Storage.getAllHorses();
    if (horses.length === 0) { alert('没有架空马数据'); return; }

    const wb = XLSX.utils.book_new();
    const allResults = await Storage.getAllEntities('results');

    for (const horse of horses) {
      const sheetName = (horse.name_en || horse.name_ja || horse.id).substring(0, 31).replace(/[\\\/\?\*\[\]]/g, '');
      const ws = await this._buildSheet(horse, allResults);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    XLSX.writeFile(wb, `UmaStudio_${new Date().toISOString().slice(0,10)}.xlsx`);
  },

  async _buildSheet(horse, allResults) {
    const data = [];
    const merges = [];
    const styles = []; // {r, c, bg} 用于追踪需要着色的单元格
    let row = 0;

    // === 基本信息 ===
    data.push(['基本信息']);
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 5 } });
    row++;

    const surfaceStr = (horse.aptitude_surface || []).map(s => s === 'turf' ? '草地' : s === 'dirt' ? '泥地' : s).join('/');
    const colorStr = I18N.t(horse.color) || horse.color || '';

    // 获取关联实体名
    const farmName = horse.farm ? (await Storage.getEntity('farms', horse.farm))?.name || '' : '';
    const trainerName = horse.trainer ? (await Storage.getEntity('trainers', horse.trainer))?.name || '' : '';
    const ownerName = horse.owner ? (await Storage.getEntity('owners', horse.owner))?.name || '' : '';

    const info = [
      ['英文名', horse.name_en || '', '日文名', horse.name_ja || '', '中文名', horse.name_cn || ''],
      ['性别', Utils.sexLabel(horse.sex), '角色', Utils.roleLabel(horse.role), '产国', horse.country || ''],
      ['出生年', horse.birth_year || '', '毛色', colorStr, '', ''],
      ['距离适性', horse.distance_min && horse.distance_max ? `${horse.distance_min}-${horse.distance_max}m` : '', '场地适性', surfaceStr, '', ''],
      ['马主', ownerName, '练马师', trainerName, '牧场', farmName],
    ];
    if (horse.name_meaning) info.push(['名字含义', horse.name_meaning, '', '', '', '']);
    if (horse.notes) info.push(['备注', horse.notes, '', '', '', '']);
    data.push(...info);
    row += info.length;

    // 空行
    data.push([]);
    row++;

    // === 血统表 ===
    data.push(['五代血统表']);
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 4 } });
    row++;

    const tree = await Pedigree.getPedigreeTree(horse.id);
    const pedStartRow = row;
    if (tree) {
      const pedResult = this._buildPedigreeTable(tree);
      data.push(...pedResult.rows);
      for (const m of pedResult.merges) {
        merges.push({
          s: { r: m.s.r + pedStartRow, c: m.s.c },
          e: { r: m.e.r + pedStartRow, c: m.e.c }
        });
      }
      // 记录牡马单元格位置
      for (const s of pedResult.maleCells) {
        styles.push({ r: s.r + pedStartRow, c: s.c, rs: s.rs });
      }
      row += pedResult.rows.length;
    } else {
      data.push(['（无血统数据）']);
      row++;
    }

    // 空行
    data.push([]);
    row++;

    // === 比赛记录 ===
    data.push(['比赛记录']);
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 9 } });
    row++;

    const records = [];
    for (const r of allResults) {
      const entry = (r.entries || []).find(e => e.horse_id === horse.id);
      if (entry) records.push({ ...r, _entry: entry });
    }

    if (records.length > 0) {
      // 排序：年份正序，同年按日程正序
      const parseSchedule = (s) => {
        const m = s?.match(/(\d+)月第(\d+)周第(\d+)/);
        return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
      };
      records.sort((a, b) => {
        if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0);
        const [am, aw, ad] = parseSchedule(a.schedule);
        const [bm, bw, bd] = parseSchedule(b.schedule);
        return am - bm || aw - bw || ad - bd;
      });

      data.push(['年', '日程', '赛马场', '赛名', '等级', '距离', '场地', '名次', '骑手', '用时']);
      row++;
      for (const r of records) {
        const e = r._entry;
        const jockey = e.jockey_id ? await Storage.getEntity('jockeys', e.jockey_id) : null;
        const finish = e.status === 'disqualified' ? '失格' : e.status === 'pulled_up' ? '中止' : e.status === 'scratched' ? '取消' : e.finish || '';
        data.push([
          r.year || '',
          r.schedule || '',
          r.venue || '',
          r.race_name || '',
          r.grade || '',
          r.distance ? r.distance + 'm' : '',
          r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : '',
          finish,
          jockey ? jockey.name : '',
          e.time || ''
        ]);
        row++;
      }
    } else {
      data.push(['（无出赛记录）']);
      row++;
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 10 }
    ];

    // 应用样式：血统表垂直居中 + 牡马浅蓝背景
    for (const s of styles) {
      for (let r = s.r; r < s.r + s.rs; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: s.c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        if (!ws[addr].s) ws[addr].s = {};
        ws[addr].s.fill = { fgColor: { rgb: 'DCE6F1' } };
        ws[addr].s.alignment = { vertical: 'center' };
      }
    }
    // 所有血统表区域垂直居中
    if (tree) {
      for (let r = pedStartRow; r < pedStartRow + 32; r++) {
        for (let c = 0; c < 5; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (!ws[addr]) ws[addr] = { v: '', t: 's' };
          if (!ws[addr].s) ws[addr].s = {};
          ws[addr].s.alignment = { vertical: 'center', wrapText: true };
        }
      }
    }

    return ws;
  },

  _buildPedigreeTable(tree) {
    const totalRows = 32;
    const rows = [];
    const merges = [];
    const maleCells = []; // 记录牡马位置 {r, c, rs}

    for (let i = 0; i < totalRows; i++) {
      rows.push(['', '', '', '', '']);
    }

    this._fillPedCell(tree.sire, rows, merges, maleCells, 0, 0, 16, 0, true);
    this._fillPedCell(tree.dam, rows, merges, maleCells, 0, 16, 16, 0, false);

    return { rows, merges, maleCells };
  },

  _fillPedCell(node, rows, merges, maleCells, col, startRow, span, depth, isMale) {
    if (depth >= 5 || !node) return;

    const name = node.name_en ? `${node.name_en}${node.country ? '(' + node.country + ')' : ''}` : '—';
    rows[startRow][col] = name;

    if (span > 1) {
      merges.push({
        s: { r: startRow, c: col },
        e: { r: startRow + span - 1, c: col }
      });
    }

    if (isMale) {
      maleCells.push({ r: startRow, c: col, rs: span });
    }

    const half = Math.floor(span / 2);
    if (half >= 1 && depth < 4) {
      this._fillPedCell(node.sire, rows, merges, maleCells, col + 1, startRow, half, depth + 1, true);
      this._fillPedCell(node.dam, rows, merges, maleCells, col + 1, startRow + half, half, depth + 1, false);
    }
  }
};
