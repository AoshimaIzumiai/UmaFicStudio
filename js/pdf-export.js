/* pdf-export.js — PDF 导出模块 */
'use strict';

const PDFExport = {
  currentHorseId: null,

  showModal(horseId) {
    this.currentHorseId = horseId;
    document.getElementById('pdf-modal').style.display = 'flex';
  },

  _closeModal() {
    document.getElementById('pdf-modal').style.display = 'none';
  },

  async _confirmExport(generations) {
    this._closeModal();
    const btn = document.getElementById('btn-export-pdf');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const horseId = this.currentHorseId;
      const horse = await Pedigree._findHorse(horseId);
      const tree = await Pedigree.getPedigreeTree(horseId);
      if (!tree) { alert('无血统数据，无法导出'); return; }

      // 临时设置代数
      const origGens = UIPedigree.currentGens;
      UIPedigree.currentGens = generations;
      const crossResult = Cross.calculateCross(tree, generations);
      const tableHtml = UIPedigree._renderTable(tree, crossResult, horse, true);
      const crossHtml = UIPedigree._renderCrossPanel(crossResult);
      UIPedigree.currentGens = origGens;

      // 构建屏幕外容器
      const container = this._createOffscreenContainer();
      const displayName = Utils.safeDisplayName(horse);
      container.innerHTML = `
        <h3 style="margin:0 0 8px">${displayName}</h3>
        ${tableHtml}
        ${crossHtml || ''}
        <div style="text-align:right;color:#999;font-size:11px;padding:8px 0">Made with UmaFicStudio</div>
      `;
      document.body.appendChild(container);

      // html2canvas 截图
      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      this._cleanup(container);

      // 根据内容宽高比自动选择方向
      const { jsPDF } = window.jspdf;
      const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth - 10;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;

      if (imgHeight > pageHeight - 10) {
        const scaledWidth = (canvas.width / canvas.height) * (pageHeight - 10);
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, scaledWidth, pageHeight - 10);
      } else {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, imgWidth, imgHeight);
      }

      // PDF 文字水印
      pdf.setFontSize(9);
      pdf.setTextColor(180);
      pdf.text('Made with UmaFicStudio', pageWidth - 5, pageHeight - 3, { align: 'right' });

      // 下载
      const filename = `${this._sanitizeFilename(displayName)}_pedigree_${generations}gen.pdf`;
      pdf.save(filename);
    } catch (e) {
      console.error('[PDFExport]', e);
      alert('PDF 生成失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  _createOffscreenContainer() {
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;top:0;background:#fff;padding:16px;display:inline-block;';
    div.className = 'pdf-render-area';
    return div;
  },

  _createProfileContainer() {
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;top:0;background:#fff;padding:20px;display:inline-block;min-width:700px;';
    div.className = 'pdf-render-area';
    return div;
  },

  _cleanup(container) {
    if (container && container.parentNode) container.parentNode.removeChild(container);
  },

  /** 通用：HTML 内容 → 截图 → 生成 PDF 并下载 */
  async _htmlToPDF(htmlContent, filename) {
    const container = this._createOffscreenContainer();
    container.innerHTML = htmlContent;
    document.body.appendChild(container);
    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    this._cleanup(container);
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 10;
    const imgHeight = (canvas.height / canvas.width) * imgWidth;
    if (imgHeight > pageHeight - 10) {
      const scaledWidth = (canvas.width / canvas.height) * (pageHeight - 10);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, scaledWidth, pageHeight - 10);
    } else {
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, imgWidth, imgHeight);
    }
    pdf.setFontSize(9);
    pdf.setTextColor(180);
    pdf.text('Made with UmaFicStudio', pageWidth - 5, pageHeight - 3, { align: 'right' });
    pdf.save(filename);
  },

  /** 通用：HTML 内容 → 截图 → 下载 PNG */
  async _htmlToPNG(htmlContent, filename) {
    const container = this._createOffscreenContainer();
    container.innerHTML = htmlContent;
    document.body.appendChild(container);
    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    this._cleanup(container);
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  },

  /** 构建战绩表 HTML（用于档案导出） */
  async _buildRaceRecordHtml(horseId, horse) {
    const allResults = await Storage.getAllEntities('results');
    const records = [];
    for (const r of allResults) {
      const entry = (r.entries || []).find(e => e.horse_id === horseId);
      if (entry) records.push({ ...r, _entry: entry });
    }
    if (records.length === 0) return '';

    // 排序
    const parseSchedule = (s) => { const m = s?.match(/(\d+)月第(\d+)周第(\d+)/); return m ? [+m[1],+m[2],+m[3]] : [99,99,99]; };
    records.sort((a, b) => {
      if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0);
      const [am,aw,ad] = parseSchedule(a.schedule); const [bm,bw,bd] = parseSchedule(b.schedule);
      return am-bm || aw-bw || ad-bd;
    });

    // 统计
    const entries = records.map(r => r._entry);
    const validEntries = entries.filter(e => !e.status || e.status === 'relegated');
    const total = validEntries.length;
    const wins = validEntries.filter(e => e.finish === 1).length;
    const seconds = validEntries.filter(e => e.finish === 2).length;
    const thirds = validEntries.filter(e => e.finish === 3).length;
    const rest = total - wins - seconds - thirds;
    const birthYear = horse?.birth_year;

    // 读取当前页面上的列隐藏状态（16列，最后一列"操作"导出时始终隐藏）
    // 列顺序：日程,赛马场,赛名,等级,头数,闸位,人气,名次,骑手,斤量,距离,场地,马场,用时,着差,操作
    const colNames = ['日程','赛马场','赛名','等级','头数','闸位','人气','名次','骑手','斤量','距离','场地','马场','用时','着差'];
    const colVisible = new Array(15).fill(true);
    const tbl = document.getElementById('race-record-tbl');
    if (tbl) {
      const headerRow = tbl.querySelector('thead tr');
      if (headerRow) {
        for (let i = 0; i < 15; i++) {
          const th = headerRow.children[i];
          if (th && th.style.display === 'none') colVisible[i] = false;
        }
      }
    }
    // 居中的列索引（除日程0、赛马场1、赛名2、骑手8外均居中）
    const centerCols = new Set([3,4,5,6,7,9,10,11,12,13,14]);

    const rows = await Promise.all(records.map(async r => {
      const e = r._entry;
      const age = birthYear && r.year ? r.year - birthYear : '';
      const ageStr = age ? `(${age}岁)` : '';
      // 完整日程格式
      const schMatch = r.schedule?.match(/(\d+)月第(\d+)周第(\d+)/);
      const schFull = schMatch ? `${schMatch[1]}月第${schMatch[2]}周第${schMatch[3]}比赛日` : '';
      const dateCol = (r.year ? `${r.year}年` : '') + schFull + ageStr;
      const surfaceShort = r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : '';
      const trackCond = {'good':'良','slightly_heavy':'稍重','heavy':'重','bad':'不良'}[r.track_condition] || '';
      const jockey = e.jockey_id ? await Storage.getEntity('jockeys', e.jockey_id) : null;
      const finishDisplay = e.status === 'disqualified' ? '失格' : e.status === 'pulled_up' ? '中止' : e.status === 'scratched' ? '取消' : e.status === 'excluded' ? '除外' : e.status === 'relegated' ? e.finish + '(降)' : e.finish;

      const cells = [
        dateCol, r.venue || '', r.race_name || '', r.grade || '',
        r.runners || '', e.gate || '', e.popularity || '', finishDisplay,
        jockey ? jockey.name : '', e.weight || '', r.distance || '',
        surfaceShort, trackCond, e.time || '', e.margin || ''
      ];

      return '<tr>' + cells.map((c, i) => {
        if (!colVisible[i]) return '';
        const align = centerCols.has(i) ? 'text-align:center;' : '';
        const ws = i === 0 ? 'white-space:nowrap;' : '';
        return `<td style="${align}${ws}">${c}</td>`;
      }).join('') + '</tr>';
    }));

    const headerCells = colNames.map((name, i) => {
      if (!colVisible[i]) return '';
      const align = centerCols.has(i) ? 'text-align:center;' : '';
      return `<th style="${align}">${name}</th>`;
    }).join('');

    return `
      <h3 style="margin:16px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px">战绩 ${total}战${wins}胜 [${wins}-${seconds}-${thirds}-${rest}]</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto;">
        <thead><tr style="border-bottom:1px solid #999;font-weight:bold">${headerCells}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  },

  /** 构建产驹成绩 HTML（用于档案导出） */
  async _buildProgenyHtml(horse) {
    if (!horse || horse.type !== 'fictional') return '';
    const role = horse.role;
    if (role !== 'stallion' && role !== 'broodmare') return '';

    const allHorses = await Storage.getAllHorses();
    const allResults = await Storage.getAllEntities('results');

    const buildList = (progeny) => {
      return progeny.map(h => {
        const records = [];
        for (const r of allResults) {
          const e = (r.entries || []).find(e => e.horse_id === h.id);
          if (e && e.finish) records.push({ ...r, _finish: e.finish });
        }
        const total = records.length;
        const wins = records.filter(r => r._finish === 1).length;
        const gradeOrder = { G1: 0, JG1: 0, G2: 1, JG2: 1, G3: 2, JG3: 2, L: 3 };
        const winRecords = records.filter(r => r._finish === 1).sort((a, b) => {
          const ga = gradeOrder[a.grade] ?? 99, gb = gradeOrder[b.grade] ?? 99;
          return ga !== gb ? ga - gb : (b.year || 0) - (a.year || 0);
        });
        return { horse: h, total, wins, bestWin: winRecords[0] || null, sireName: h.sire_id ? (allHorses.find(s => s.id === h.sire_id) || {name_en: h.sire_id}).name_en : '—' };
      }).sort((a, b) => b.wins - a.wins || (b.total > 0 ? b.wins/b.total : 0) - (a.total > 0 ? a.wins/a.total : 0));
    };

    const renderTable = (list, showSire) => {
      if (list.length === 0) return '<p style="color:#999;font-size:11px">—</p>';
      let html = '<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="border-bottom:1px solid #999;font-weight:bold"><th>马名</th>' + (showSire ? '<th>父</th>' : '') + '<th style="text-align:center">性别</th><th style="text-align:center">生年</th><th style="text-align:center">战绩</th><th>主胜鞍</th></tr></thead><tbody>';
      for (const item of list) {
        const h = item.horse;
        const record = item.total > 0 ? `${item.total}战${item.wins}胜` : '—';
        const best = item.bestWin ? `${item.bestWin.race_name || ''}(${item.bestWin.grade || ''})` : '—';
        html += `<tr><td>${Utils.safeDisplayName(h)}</td>${showSire ? `<td>${item.sireName}</td>` : ''}<td style="text-align:center">${Utils.sexLabel(h.sex)}</td><td style="text-align:center">${h.birth_year || '—'}</td><td style="text-align:center">${record}</td><td>${best}</td></tr>`;
      }
      return html + '</tbody></table>';
    };

    let html = '';
    if (role === 'stallion') {
      const progeny = allHorses.filter(h => h.sire_id === horse.id);
      const bmsProgeny = allHorses.filter(h => {
        if (!h.dam_id) return false;
        const dam = allHorses.find(d => d.id === h.dam_id);
        return dam && dam.sire_id === horse.id;
      });
      if (progeny.length > 0) {
        html += `<h3 style="margin:16px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px">产驹成绩</h3>`;
        html += renderTable(buildList(progeny));
      }
      if (bmsProgeny.length > 0) {
        html += `<h3 style="margin:16px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px">BMS成绩</h3>`;
        html += renderTable(buildList(bmsProgeny));
      }
    } else {
      const progeny = allHorses.filter(h => h.dam_id === horse.id);
      const list = buildList(progeny);
      for (const item of list) {
        if (item.horse.sire_id && !allHorses.find(s => s.id === item.horse.sire_id)) {
          const s = await Pedigree._findHorse(item.horse.sire_id);
          if (s) item.sireName = Utils.safeDisplayName(s);
        }
      }
      html += `<h3 style="margin:16px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px">产驹 (${progeny.length}頭)</h3>`;
      html += renderTable(list, true);
    }
    return html;
  },

  _sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '_').replace(/_+/g, '_');
  },

  // === PNG 导出 ===

  async exportPNG(horseId, generations) {
    try {
      const horse = await Pedigree._findHorse(horseId);
      const tree = await Pedigree.getPedigreeTree(horseId);
      if (!tree) { alert('无血统数据'); return; }

      const origGens = UIPedigree.currentGens;
      UIPedigree.currentGens = generations;
      const crossResult = Cross.calculateCross(tree, generations);
      const tableHtml = UIPedigree._renderTable(tree, crossResult, horse, true);
      const crossHtml = UIPedigree._renderCrossPanel(crossResult);
      UIPedigree.currentGens = origGens;

      const container = this._createOffscreenContainer();
      const displayName = Utils.safeDisplayName(horse);
      container.innerHTML = `
        <h3 style="margin:0 0 8px">${displayName}</h3>
        ${tableHtml}
        ${crossHtml || ''}
        <div style="text-align:right;color:#999;font-size:11px;padding:8px 0">Made with UmaFicStudio</div>
      `;
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      this._cleanup(container);

      const link = document.createElement('a');
      link.download = `${this._sanitizeFilename(displayName)}_pedigree_${generations}gen.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[PNG Export]', e);
      alert('PNG 导出失败：' + e.message);
    }
  },

  // === 档案导出 ===

  showProfileModal(horseId) {
    this.currentHorseId = horseId;
    document.getElementById('profile-modal').style.display = 'flex';
  },

  _closeProfileModal() {
    document.getElementById('profile-modal').style.display = 'none';
  },

  async _confirmProfileExport(generations) {
    this._closeProfileModal();
    const btn = document.querySelector('[onclick*="showProfileModal"]');
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

    try {
      const horseId = this.currentHorseId;
      const horse = await Storage.getHorse(horseId);
      if (!horse) { alert('找不到马匹数据'); return; }
      const tree = await Pedigree.getPedigreeTree(horseId);

      const origGens = UIPedigree.currentGens;
      UIPedigree.currentGens = generations;
      const crossResult = tree ? Cross.calculateCross(tree, generations) : null;
      const tableHtml = tree ? UIPedigree._renderTable(tree, crossResult, horse, true) : '<p>无血统数据</p>';
      const crossHtml = crossResult ? UIPedigree._renderCrossPanel(crossResult) : '';
      UIPedigree.currentGens = origGens;

      const displayName = Utils.safeDisplayName(horse);
      const profileHtml = await this._buildProfileInfoHtml(horse, displayName, generations);
      const raceHtml = await this._buildRaceRecordHtml(horseId, horse);
      const progenyHtml = await this._buildProgenyHtml(horse);

      // 第一部分：基本信息 + 血统表 + Cross
      const part1 = this._createProfileContainer();
      part1.innerHTML = `${profileHtml}
        <h3 style="margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px">${generations}代血统表</h3>
        ${tableHtml}
        ${crossHtml}`;
      document.body.appendChild(part1);
      const canvas1 = await html2canvas(part1, { scale: 2, useCORS: true });
      this._cleanup(part1);

      // 第二部分：战绩表 + 产驹
      let canvas2 = null;
      const part2Content = (raceHtml || '') + (progenyHtml || '');
      if (part2Content) {
        const part2 = this._createProfileContainer();
        part2.innerHTML = part2Content;
        document.body.appendChild(part2);
        canvas2 = await html2canvas(part2, { scale: 2, useCORS: true });
        this._cleanup(part2);
      }

      // 生成分页 PDF（全部 portrait A4）
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 5;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      this._addCanvasPages(pdf, canvas1, usableW, usableH, margin);
      if (canvas2) {
        pdf.addPage();
        this._addCanvasPages(pdf, canvas2, usableW, usableH, margin);
      }

      // 最后一页底部水印
      pdf.setFontSize(9);
      pdf.setTextColor(180);
      pdf.text('Made with UmaFicStudio', pageW - margin, pageH - 3, { align: 'right' });

      const filename = `${this._sanitizeFilename(displayName)}_profile_${generations}gen.pdf`;
      pdf.save(filename);
    } catch (e) {
      console.error('[PDFExport Profile]', e);
      alert('档案导出失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📋 档案'; }
    }
  },

  /** 将一个 canvas 按 A4 页高裁剪为多页 */
  _addCanvasPages(pdf, canvas, usableW, usableH, margin) {
    const imgW = usableW;
    const imgH = (canvas.height / canvas.width) * imgW;

    if (imgH <= usableH) {
      // 单页放得下
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, imgH);
      return;
    }

    // 需要分页：按像素高度裁剪
    const scale = canvas.width / imgW; // px per mm
    const sliceHeightPx = Math.floor(usableH * scale);
    const totalPages = Math.ceil(canvas.height / sliceHeightPx);

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) pdf.addPage();
      const srcY = i * sliceHeightPx;
      const srcH = Math.min(sliceHeightPx, canvas.height - srcY);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = srcH;
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
      const sliceImgH = (srcH / canvas.width) * imgW;
      pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, sliceImgH);
    }
  },

  /** 构建基本信息 HTML（复用于 PDF 和 PNG） */
  async _buildProfileInfoHtml(horse, displayName, generations) {
    const subNames = [horse.name_ja, horse.name_cn].filter(Boolean).join('  ');
    return `
      <div class="profile-header">
        <h2 style="margin:0;font-size:18px">${displayName}${subNames ? `  <span style="font-size:14px;color:#555">${subNames}</span>` : ''}</h2>
        ${horse.created_mode ? `<span class="mode-badge ${horse.created_mode === 'strict' ? 'mode-strict' : ''}">${horse.created_mode === 'strict' ? '严谨' : '架空'}</span>` : ''}
      </div>
      <table class="profile-info" style="font-size:11px">
        <tr><td><b>性别</b></td><td>${Utils.sexLabel(horse.sex)}</td><td><b>出生年</b></td><td>${horse.birth_year || '—'}</td></tr>
        <tr><td><b>产国</b></td><td>${horse.country || '—'}</td><td><b>毛色</b></td><td>${Utils.colorLabel(horse.color) || '—'}</td></tr>
        <tr><td><b>角色</b></td><td>${Utils.roleLabel(horse.role)}</td><td><b>配种年份</b></td><td>${horse.stud_year_start ? horse.stud_year_start + '—' + (horse.stud_year_end || '') : '—'}</td></tr>
        <tr><td><b>场地</b></td><td>${(horse.aptitude_surface || []).map(s => Utils.surfaceLabel(s)).join('/') || '—'}</td><td><b>距离</b></td><td>${horse.distance_min && horse.distance_max ? horse.distance_min + '-' + horse.distance_max + 'm' : (horse.aptitude_distance || []).map(d => ({sprint:'短途',mile:'一哩',intermediate:'中距离',long:'长途'}[d]||d)).join('/') || '—'}</td></tr>
      </table>
      ${horse.farm || horse.trainer || horse.owner || horse.purchase_price || horse.name_meaning || horse.notes ? `
      <table class="profile-info" style="margin-top:8px">
        ${horse.farm ? `<tr><td><b>出生牧场</b></td><td colspan="3">${await this._resolveEntity('farms', horse.farm)}</td></tr>` : ''}
        ${horse.trainer || horse.owner ? `<tr>${horse.trainer ? `<td><b>练马师</b></td><td>${await this._resolveEntity('trainers', horse.trainer)}</td>` : '<td></td><td></td>'}${horse.owner ? `<td><b>马主</b></td><td>${await this._resolveEntity('owners', horse.owner)}</td>` : '<td></td><td></td>'}</tr>` : ''}
        ${horse.purchase_price ? `<tr><td><b>购入价格</b></td><td colspan="3">${Utils.escapeHtml(horse.purchase_price)}</td></tr>` : ''}
        ${horse.name_meaning ? `<tr><td><b>马名含义</b></td><td colspan="3">${Utils.escapeHtml(horse.name_meaning)}</td></tr>` : ''}
        ${horse.notes ? `<tr><td><b>备注</b></td><td colspan="3">${Utils.escapeHtml(horse.notes)}</td></tr>` : ''}
      </table>
      ` : ''}`;
  },

  /** 档案 PNG 长图导出 */
  async exportProfilePNG(generations) {
    this._closeProfileModal();
    try {
      const horseId = this.currentHorseId;
      const horse = await Storage.getHorse(horseId);
      if (!horse) { alert('找不到马匹数据'); return; }
      const tree = await Pedigree.getPedigreeTree(horseId);

      const origGens = UIPedigree.currentGens;
      UIPedigree.currentGens = generations;
      const crossResult = tree ? Cross.calculateCross(tree, generations) : null;
      const tableHtml = tree ? UIPedigree._renderTable(tree, crossResult, horse, true) : '<p>无血统数据</p>';
      const crossHtml = crossResult ? UIPedigree._renderCrossPanel(crossResult) : '';
      UIPedigree.currentGens = origGens;

      const displayName = Utils.safeDisplayName(horse);
      const profileHtml = await this._buildProfileInfoHtml(horse, displayName, generations);
      const raceHtml = await this._buildRaceRecordHtml(horseId, horse);
      const progenyHtml = await this._buildProgenyHtml(horse);

      const container = this._createProfileContainer();
      container.innerHTML = `${profileHtml}
        <h3 style="margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px">${generations}代血统表</h3>
        ${tableHtml}
        ${crossHtml}
        ${raceHtml || ''}
        ${progenyHtml || ''}
        <div style="text-align:right;color:#888;font-size:12px;padding:12px 0 0">@umaficstudio</div>`;
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { scale: 3, useCORS: true });
      this._cleanup(container);

      const link = document.createElement('a');
      link.download = `${this._sanitizeFilename(displayName)}_profile_${generations}gen.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[PNG Profile Export]', e);
      alert('PNG 导出失败：' + e.message);
    }
  },

  async _resolveEntity(store, id) {
    if (!id) return '';
    const entity = await Storage.getEntity(store, id);
    return entity ? entity.name : id;
  }
};
