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
      const tableHtml = UIPedigree._renderTable(tree, crossResult, horse);
      const crossHtml = UIPedigree._renderCrossPanel(crossResult);
      UIPedigree.currentGens = origGens;

      // 构建屏幕外容器
      const container = this._createOffscreenContainer();
      const displayName = Utils.displayName(horse);
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
    const total = entries.length;
    const wins = entries.filter(e => e.finish === 1).length;
    const seconds = entries.filter(e => e.finish === 2).length;
    const thirds = entries.filter(e => e.finish === 3).length;
    const rest = total - wins - seconds - thirds;
    const birthYear = horse?.birth_year;

    // 构建紧凑表格
    const rows = await Promise.all(records.map(async r => {
      const e = r._entry;
      const age = birthYear && r.year ? r.year - birthYear : '';
      // 日程紧凑：月-周-日
      const schMatch = r.schedule?.match(/(\d+)月第(\d+)周第(\d+)/);
      const schShort = schMatch ? `${schMatch[1]}-${schMatch[2]}-${schMatch[3]}` : '';
      const dateCol = r.year ? `${r.year} ${schShort}` : schShort;
      const ageCol = age ? `${age}岁` : '';
      const surfaceShort = r.surface === 'turf' ? '草' : r.surface === 'dirt' ? '泥' : '';
      const jockey = e.jockey_id ? await Storage.getEntity('jockeys', e.jockey_id) : null;
      return `<tr>
        <td style="white-space:nowrap">${dateCol}</td>
        <td>${ageCol}</td>
        <td>${r.race_name || ''}</td>
        <td>${r.grade || ''}</td>
        <td>${r.distance || ''}</td>
        <td>${surfaceShort}</td>
        <td>${e.finish}</td>
        <td>${e.popularity || ''}</td>
        <td>${e.weight || ''}</td>
        <td>${jockey ? jockey.name : ''}</td>
      </tr>`;
    }));

    return `
      <h3 style="margin:16px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px">战绩 ${total}战${wins}胜 [${wins}-${seconds}-${thirds}-${rest}]</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:auto;">
        <thead><tr style="border-bottom:1px solid #999;font-weight:bold">
          <th style="white-space:nowrap">日程</th><th style="white-space:nowrap">年龄</th><th>赛名</th><th style="white-space:nowrap">等级</th><th style="white-space:nowrap">距离</th><th style="white-space:nowrap">场地</th><th style="white-space:nowrap">着顺</th><th style="white-space:nowrap">人气</th><th style="white-space:nowrap">负重</th><th>骑手</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
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
      const tableHtml = UIPedigree._renderTable(tree, crossResult, horse);
      const crossHtml = UIPedigree._renderCrossPanel(crossResult);
      UIPedigree.currentGens = origGens;

      const container = this._createOffscreenContainer();
      const displayName = Utils.displayName(horse);
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
      const tableHtml = tree ? UIPedigree._renderTable(tree, crossResult, horse) : '<p>无血统数据</p>';
      const crossHtml = crossResult ? UIPedigree._renderCrossPanel(crossResult) : '';
      UIPedigree.currentGens = origGens;

      const container = this._createProfileContainer();
      const displayName = Utils.displayName(horse);
      container.innerHTML = `
        <div class="profile-header">
          <h2 style="margin:0;font-size:18px">${displayName}</h2>
          ${horse.created_mode ? `<span class="mode-badge ${horse.created_mode === 'strict' ? 'mode-strict' : ''}">${horse.created_mode === 'strict' ? '严谨' : '架空'}</span>` : ''}
        </div>
        <table class="profile-info" style="font-size:11px">
          <tr><td><b>性别</b></td><td>${Utils.sexLabel(horse.sex)}</td><td><b>出生年</b></td><td>${horse.birth_year || '—'}</td></tr>
          <tr><td><b>产国</b></td><td>${horse.country || '—'}</td><td><b>毛色</b></td><td>${Utils.colorLabel(horse.color) || '—'}</td></tr>
          <tr><td><b>角色</b></td><td>${Utils.roleLabel(horse.role)}</td><td><b>配种年份</b></td><td>${horse.stud_year_start ? horse.stud_year_start + '—' + (horse.stud_year_end || '') : '—'}</td></tr>
          <tr><td><b>场地</b></td><td>${(horse.aptitude_surface || []).map(s => Utils.surfaceLabel(s)).join('/') || '—'}</td><td><b>距离</b></td><td>${(horse.aptitude_distance || []).map(d => ({sprint:'短途',mile:'一哩',intermediate:'中距离',long:'长途'}[d]||d)).join('/') || '—'}</td></tr>
        </table>
        ${horse.farm || horse.trainer || horse.owner || horse.name_meaning || horse.notes ? `
        <table class="profile-info" style="margin-top:8px">
          ${horse.farm ? `<tr><td><b>出生牧场</b></td><td colspan="3">${horse.farm}</td></tr>` : ''}
          ${horse.trainer || horse.owner ? `<tr>${horse.trainer ? `<td><b>练马师</b></td><td>${horse.trainer}</td>` : '<td></td><td></td>'}${horse.owner ? `<td><b>马主</b></td><td>${horse.owner}</td>` : '<td></td><td></td>'}</tr>` : ''}
          ${horse.name_meaning ? `<tr><td><b>马名含义</b></td><td colspan="3">${horse.name_meaning}</td></tr>` : ''}
          ${horse.notes ? `<tr><td><b>备注</b></td><td colspan="3">${horse.notes}</td></tr>` : ''}
        </table>
        ` : ''}
        <h3 style="margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px">${generations}代血统表</h3>
        ${tableHtml}
        ${crossHtml}
        ${await this._buildRaceRecordHtml(horseId, horse)}
        <div style="text-align:right;color:#999;font-size:11px;padding:12px 0 0">Made with UmaFicStudio</div>
      `;
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      this._cleanup(container);

      const { jsPDF } = window.jspdf;
      const orientation = canvas.width > canvas.height * 0.8 ? 'landscape' : 'portrait';
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

      const filename = `${this._sanitizeFilename(displayName)}_profile_${generations}gen.pdf`;
      pdf.save(filename);
    } catch (e) {
      console.error('[PDFExport Profile]', e);
      alert('档案导出失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📋 档案'; }
    }
  }
};
