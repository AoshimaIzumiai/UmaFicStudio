/* excel-export.js — 架空马数据导出为 Excel（ExcelJS） */
const ExcelExport = {

  MALE_FILL: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } },
  FEMALE_FILL: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8EC' } },
  HEADER_FILL: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } },
  HEADER_FONT: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  THIN_BORDER: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },

  async exportAll() {
    const horses = await Storage.getAllHorses();
    if (horses.length === 0) { alert('没有架空马数据'); return; }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'UmaFicStudio';
    const allResults = await Storage.getAllEntities('results');

    for (const horse of horses) {
      const sheetName = (horse.name_en || horse.name_ja || horse.id).substring(0, 31).replace(/[\\\/\?\*\[\]:]/g, '');
      await this._buildSheet(wb, sheetName, horse, allResults);
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `UmaFicStudio_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async _buildSheet(wb, sheetName, horse, allResults) {
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
      { width: 10 }, { width: 8 }, { width: 8 }, { width: 14 }, { width: 10 }
    ];

    let row = 1;

    // === 基本信息 ===
    const titleRow = ws.getRow(row);
    ws.mergeCells(row, 1, row, 6);
    titleRow.getCell(1).value = '基本信息';
    titleRow.getCell(1).font = { bold: true, size: 12 };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    row++;

    const surfaceStr = (horse.aptitude_surface || []).map(s => s === 'turf' ? '草地' : s === 'dirt' ? '泥地' : s).join('/');
    const colorStr = I18N.t(horse.color) || horse.color || '';
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

    for (const r of info) {
      const wsRow = ws.getRow(row);
      r.forEach((v, i) => {
        const cell = wsRow.getCell(i + 1);
        cell.value = v;
        if (i % 2 === 0) cell.font = { bold: true, size: 10 };
      });
      row++;
    }
    row++;

    // === 血统表 ===
    ws.mergeCells(row, 1, row, 5);
    const pedTitle = ws.getRow(row).getCell(1);
    pedTitle.value = '五代血统表';
    pedTitle.font = { bold: true, size: 12 };
    pedTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    row++;

    const tree = await Pedigree.getPedigreeTree(horse.id);
    const pedStartRow = row;
    if (tree) {
      this._fillPedigreeExcel(ws, tree, pedStartRow);
      row += 32;
    } else {
      ws.getRow(row).getCell(1).value = '（无血统数据）';
      row++;
    }
    row++;

    // === 比赛记录 ===
    ws.mergeCells(row, 1, row, 10);
    const recTitle = ws.getRow(row).getCell(1);
    recTitle.value = '比赛记录';
    recTitle.font = { bold: true, size: 12 };
    recTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    row++;

    const records = [];
    for (const r of allResults) {
      const entry = (r.entries || []).find(e => e.horse_id === horse.id);
      if (entry) records.push({ ...r, _entry: entry });
    }

    if (records.length > 0) {
      const parseSchedule = (s) => { const m = s?.match(/(\d+)月第(\d+)周第(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };
      records.sort((a, b) => { if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0); const [am, aw, ad] = parseSchedule(a.schedule); const [bm, bw, bd] = parseSchedule(b.schedule); return am - bm || aw - bw || ad - bd; });

      const headers = ['年', '日程', '赛马场', '赛名', '等级', '距离', '场地', '名次', '骑手', '用时'];
      const headerRow = ws.getRow(row);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.fill = this.HEADER_FILL;
        cell.font = this.HEADER_FONT;
        cell.alignment = { horizontal: 'center' };
        cell.border = this.THIN_BORDER;
      });
      row++;

      for (const r of records) {
        const e = r._entry;
        const jockey = e.jockey_id ? await Storage.getEntity('jockeys', e.jockey_id) : null;
        const finish = e.status === 'disqualified' ? '失格' : e.status === 'pulled_up' ? '中止' : e.status === 'scratched' ? '取消' : e.finish || '';
        const vals = [r.year || '', r.schedule || '', r.venue || '', r.race_name || '', r.grade || '', r.distance ? r.distance + 'm' : '', r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : '', finish, jockey ? jockey.name : '', e.time || ''];
        const wsRow = ws.getRow(row);
        vals.forEach((v, i) => {
          const cell = wsRow.getCell(i + 1);
          cell.value = v;
          cell.border = this.THIN_BORDER;
          cell.alignment = { vertical: 'center' };
        });
        // 着顺着色
        if (e.finish === 1) wsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
        row++;
      }
    } else {
      ws.getRow(row).getCell(1).value = '（无出赛记录）';
      row++;
    }

    // === 产驹成绩 ===
    if (horse.role === 'stallion' || horse.role === 'broodmare') {
      const allHorsesArr = await Storage.getAllHorses();
      const progeny = horse.role === 'stallion'
        ? allHorsesArr.filter(h => h.sire_id === horse.id)
        : allHorsesArr.filter(h => h.dam_id === horse.id);

      if (progeny.length > 0) {
        row++;
        ws.mergeCells(row, 1, row, 6);
        const progTitle = ws.getRow(row).getCell(1);
        progTitle.value = '産駒成績';
        progTitle.font = { bold: true, size: 12 };
        progTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
        row++;

        const progHeaders = ['馬名', '性別', '生年', '戦績', '重賞勝', '主勝鞍'];
        const phRow = ws.getRow(row);
        progHeaders.forEach((h, i) => {
          const cell = phRow.getCell(i + 1);
          cell.value = h;
          cell.fill = this.HEADER_FILL;
          cell.font = this.HEADER_FONT;
          cell.alignment = { horizontal: 'center' };
          cell.border = this.THIN_BORDER;
        });
        row++;

        const progList = progeny.map(p => {
          let total = 0, wins = 0, gradedWins = 0, bestWin = null;
          for (const r of allResults) {
            const e = (r.entries || []).find(e => e.horse_id === p.id);
            if (e && e.finish) {
              total++;
              if (e.finish === 1) {
                wins++;
                if (['G1','G2','G3','L','JG1','JG2','JG3'].includes(r.grade)) {
                  gradedWins++;
                  if (!bestWin || (['G1','JG1'].includes(r.grade) && !['G1','JG1'].includes(bestWin.grade))) bestWin = r;
                }
              }
            }
          }
          return { p, total, wins, gradedWins, bestWin };
        }).sort((a, b) => b.gradedWins - a.gradedWins || b.wins - a.wins);

        for (const { p, total, wins, gradedWins, bestWin } of progList) {
          const wsRow = ws.getRow(row);
          const vals = [
            Utils.displayName(p),
            Utils.sexLabel(p.sex),
            p.birth_year || '',
            total > 0 ? `${total}战${wins}胜` : '—',
            gradedWins || '',
            bestWin ? `${bestWin.race_name || ''}(${bestWin.grade || ''})` : '—'
          ];
          vals.forEach((v, i) => {
            const cell = wsRow.getCell(i + 1);
            cell.value = v;
            cell.border = this.THIN_BORDER;
          });
          row++;
        }
      }
    }
  },

  _fillPedigreeExcel(ws, tree, startRow) {
    // 32行 x 5列的血统表
    this._fillPedCell(ws, tree.sire, 0, startRow, 16, 0, true);
    this._fillPedCell(ws, tree.dam, 0, startRow + 16, 16, 0, false);
  },

  _fillPedCell(ws, node, col, startRow, span, depth, isMale) {
    if (depth >= 5 || !node) return;

    const name = node.name_en ? `${node.name_en}${node.country ? '(' + node.country + ')' : ''}` : '—';

    if (span > 1) {
      ws.mergeCells(startRow, col + 1, startRow + span - 1, col + 1);
    }

    const cell = ws.getRow(startRow).getCell(col + 1);
    cell.value = name;
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = this.THIN_BORDER;
    cell.fill = isMale ? this.MALE_FILL : this.FEMALE_FILL;
    cell.font = { size: 9 };

    // 给合并区域的其他行也设边框
    for (let r = startRow + 1; r < startRow + span; r++) {
      const c = ws.getRow(r).getCell(col + 1);
      c.border = this.THIN_BORDER;
    }

    const half = Math.floor(span / 2);
    if (half >= 1 && depth < 4) {
      this._fillPedCell(ws, node.sire, col + 1, startRow, half, depth + 1, true);
      this._fillPedCell(ws, node.dam, col + 1, startRow + half, half, depth + 1, false);
    }
  }
};
