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
        <div style="text-align:right;color:#999;font-size:11px;padding:8px 0">Made with UmaStudio</div>
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
      pdf.text('Made with UmaStudio', pageWidth - 5, pageHeight - 3, { align: 'right' });

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

  _cleanup(container) {
    if (container && container.parentNode) container.parentNode.removeChild(container);
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
        <div style="text-align:right;color:#999;font-size:11px;padding:8px 0">Made with UmaStudio</div>
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

      const container = this._createOffscreenContainer();
      const displayName = Utils.displayName(horse);
      container.innerHTML = `
        <div class="profile-header">
          <h2 style="margin:0">${displayName}</h2>
          ${horse.created_mode ? `<span class="mode-badge ${horse.created_mode === 'strict' ? 'mode-strict' : ''}">${horse.created_mode === 'strict' ? '严谨' : '架空'}</span>` : ''}
        </div>
        <table class="profile-info">
          <tr><td><b>性别</b></td><td>${Utils.sexLabel(horse.sex)}</td><td><b>出生年</b></td><td>${horse.birth_year || '—'}</td></tr>
          <tr><td><b>产国</b></td><td>${horse.country || '—'}</td><td><b>毛色</b></td><td>${horse.color || '—'}</td></tr>
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
        <div style="text-align:right;color:#999;font-size:11px;padding:12px 0 0">Made with UmaStudio</div>
      `;
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
      pdf.text('Made with UmaStudio', pageWidth - 5, pageHeight - 3, { align: 'right' });

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
