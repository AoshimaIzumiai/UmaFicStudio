/* press-export.js — PNG/PDF 导出（A4 分页） */
const PressExport = {
  // A4 @ 96dpi = 794 x 1123px
  PAGE_W: 794,
  PAGE_H: 1123,
  SCALE: 3,

  async exportPNG() {
    const preview = document.getElementById('md-preview');
    const container = preview.parentElement;
    const origStyle = container.style.cssText;
    container.style.cssText = 'overflow:visible;padding:0;display:block';
    preview.style.transform = 'none';
    preview.style.width = this.PAGE_W + 'px';

    await new Promise(r => setTimeout(r, 100));
    await PressRender.fillDataBlocks(preview);
    await new Promise(r => setTimeout(r, 200));

    try {
      const canvas = await html2canvas(preview, { width: this.PAGE_W, useCORS: true, scale: this.SCALE });
      const totalH = canvas.height;
      const pageH = this.PAGE_H * this.SCALE;
      const pageW = this.PAGE_W * this.SCALE;
      const pages = Math.ceil(totalH / pageH);
      const title = PressEditor.currentArticle?.title || 'press';

      for (let i = 0; i < pages; i++) {
        const cropped = document.createElement('canvas');
        cropped.width = pageW;
        cropped.height = Math.min(pageH, totalH - i * pageH);
        cropped.getContext('2d').drawImage(canvas, 0, -i * pageH);
        this._download(cropped, pages > 1 ? `${title}_p${i + 1}` : title);
      }
    } finally {
      container.style.cssText = origStyle;
      preview.style.transform = '';
      preview.style.width = '';
    }
  },

  async exportPDF() {
    const preview = document.getElementById('md-preview');
    const container = preview.parentElement;
    const origStyle = container.style.cssText;
    container.style.cssText = 'overflow:visible;padding:0;display:block';
    preview.style.transform = 'none';
    preview.style.width = this.PAGE_W + 'px';

    await new Promise(r => setTimeout(r, 100));
    await PressRender.fillDataBlocks(preview);
    await new Promise(r => setTimeout(r, 200));

    try {
      const canvas = await html2canvas(preview, { width: this.PAGE_W, useCORS: true, scale: this.SCALE });
      const totalH = canvas.height;
      const pageH = this.PAGE_H * this.SCALE;
      const pageW = this.PAGE_W * this.SCALE;
      const pages = Math.ceil(totalH / pageH);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'p', unit: 'px', format: [pageW, pageH] });

      for (let i = 0; i < pages; i++) {
        if (i > 0) pdf.addPage();
        const cropped = document.createElement('canvas');
        cropped.width = pageW;
        cropped.height = Math.min(pageH, totalH - i * pageH);
        cropped.getContext('2d').drawImage(canvas, 0, -i * pageH);
        pdf.addImage(cropped.toDataURL('image/png'), 'PNG', 0, 0, pageW, cropped.height);
      }
      pdf.save((PressEditor.currentArticle?.title || 'press') + '.pdf');
    } finally {
      container.style.cssText = origStyle;
      preview.style.transform = '';
      preview.style.width = '';
    }
  },

  _download(canvas, filename) {
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-export')?.addEventListener('click', () => PressExport.exportPNG());
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => PressExport.exportPDF());
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (PressEditor.currentArticle) PressStorage.exportJSON(PressEditor.currentArticle.id);
  });
});
