"use strict";

function _dataUrlBytes(dataUrl) {
  const binary = atob(dataUrl.split(',')[1]);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

TestRunner.suite('R9.5 — PDF/PNG/Excel实际生成物', t => {
  t.test('PNG应由真实html2canvas生成且具有有效签名和尺寸', async () => {
    const originalClick = HTMLAnchorElement.prototype.click;
    let captured = null;
    try {
      HTMLAnchorElement.prototype.click = function() {
        captured = { download: this.download, href: this.href };
      };
      await PDFExport._htmlToPNG(
        '<div style="width:420px;height:180px;background:#1478dc;color:#fff;padding:16px">' +
        '<h1>UmaFicStudio PNG</h1><p>競馬 🐎 export structure</p></div>',
        'r9-artifact.png'
      );
      TestRunner.assert.equal(captured.download, 'r9-artifact.png');
      TestRunner.assert.ok(captured.href.startsWith('data:image/png;base64,'));
      const bytes = _dataUrlBytes(captured.href);
      TestRunner.assert.deepEqual(Array.from(bytes.slice(0, 8)), [137,80,78,71,13,10,26,10]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      TestRunner.assert.ok(view.getUint32(16) >= 420);
      TestRunner.assert.ok(view.getUint32(20) >= 180);
      TestRunner.assert.ok(bytes.length > 1000);
      const image = new Image();
      image.src = captured.href;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('generated PNG could not be decoded'));
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(image.width - 80, image.height - 80, 1, 1).data;
      TestRunner.assert.ok(pixel[2] > pixel[0] && pixel[2] > pixel[1]);
      TestRunner.assert.ok(pixel[3] > 0);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  t.test('PDF应由真实jsPDF生成且包含有效PDF头与非空页面', async () => {
    const originalConstructor = window.jspdf.jsPDF;
    let captured = null;
    try {
      window.jspdf.jsPDF = function(...args) {
        const pdf = new originalConstructor(...args);
        pdf.save = filename => {
          captured = {
            filename,
            buffer: pdf.output('arraybuffer'),
            pages: pdf.getNumberOfPages(),
          };
        };
        return pdf;
      };
      await PDFExport._htmlToPDF(
        '<div style="width:420px;height:220px;background:#fff;color:#111;padding:16px">' +
        '<h1>UmaFicStudio PDF</h1><p>競馬 🐎 Made with UmaFicStudio</p></div>',
        'r9-artifact.pdf'
      );
      TestRunner.assert.equal(captured.filename, 'r9-artifact.pdf');
      TestRunner.assert.equal(captured.pages, 1);
      const bytes = new Uint8Array(captured.buffer);
      const header = new TextDecoder('ascii').decode(bytes.slice(0, 5));
      TestRunner.assert.equal(header, '%PDF-');
      TestRunner.assert.ok(bytes.length > 1000);
      const pdfText = new TextDecoder('latin1').decode(bytes);
      TestRunner.assert.ok(pdfText.includes('Made with UmaFicStudio'));
      const tail = pdfText.slice(-32);
      TestRunner.assert.ok(tail.includes('%%EOF'));
    } finally {
      window.jspdf.jsPDF = originalConstructor;
    }
  });

  t.test('PDF档案内容应包含肩高与动态马体重增减', async () => {
    const stamp = Date.now();
    const horseId = `r9_pdf_profile_horse_${stamp}`;
    const resultIds = [1, 2, 3].map(index => `r9_pdf_profile_result_${stamp}_${index}`);
    const horse = {
      id: horseId, name_en: 'R9 Profile Horse', type: 'fictional',
      sex: 'female', role: 'active', birth_year: 2023, height_cm: 163.5,
      aptitude_surface: ['turf'], distance_min: 1600, distance_max: 2200,
    };
    try {
      await Storage._putRaw('horses', horse);
      for (const [index, bodyWeight] of [480, 490, 488].entries()) {
        await Storage._putRaw('results', {
          id: resultIds[index], race_name: `Profile Race ${index + 1}`, grade: '条件',
          year: 2026, schedule: `${index + 1}月第1周第1比赛日`,
          entries: [{ horse_id: horseId, finish: index + 1, body_weight: bodyWeight }],
        });
      }
      const profileHtml = await PDFExport._buildProfileInfoHtml(horse, 'R9 Profile Horse', 5);
      const raceHtml = await PDFExport._buildRaceRecordHtml(horseId, horse);
      TestRunner.assert.ok(profileHtml.includes('肩高'));
      TestRunner.assert.ok(profileHtml.includes('163.5cm'));
      TestRunner.assert.ok(raceHtml.includes('马体重(增减)'));
      TestRunner.assert.ok(raceHtml.includes('480(0)'));
      TestRunner.assert.ok(raceHtml.includes('490(+10)'));
      TestRunner.assert.ok(raceHtml.includes('488(-2)'));
    } finally {
      await Storage._deleteRaw('horses', horseId);
      for (const id of resultIds) await Storage._deleteRaw('results', id);
    }
  });

  t.test('Excel应生成可重新解析的XLSX并包含基本信息、血统和比赛记录结构', async () => {
    const horseId = `r9_excel_horse_${Date.now()}`;
    const resultIds = [1, 2, 3].map(index => `${horseId}_result_${index}`);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let blob = null;
    let filename = null;
    try {
      await Storage._putRaw('horses', {
        id: horseId,
        name_en: 'R9 Export Horse',
        name_ja: '輸出馬',
        type: 'fictional',
        sex: 'male',
        role: 'racer',
        birth_year: 2024,
        height_cm: 163.5,
        country: 'JPN',
        aptitude_surface: ['turf'],
        distance_min: 1600,
        distance_max: 2400,
      });
      for (const [index, bodyWeight] of [480, 490, 488].entries()) {
        await Storage._putRaw('results', {
          id: resultIds[index], race_name: `Excel Race ${index + 1}`, grade: '条件',
          year: 2026, schedule: `${index + 1}月第1周第1比赛日`,
          entries: [{ horse_id: horseId, finish: index + 1, body_weight: bodyWeight }],
        });
      }
      URL.createObjectURL = value => { blob = value; return 'blob:r9-xlsx'; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function() { filename = this.download; };
      await ExcelExport.exportAll();
      TestRunner.assert.ok(blob instanceof Blob);
      TestRunner.assert.ok(filename.endsWith('.xlsx'));
      TestRunner.assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      TestRunner.assert.deepEqual(Array.from(bytes.slice(0, 4)), [80,75,3,4]);
      TestRunner.assert.ok(bytes.length > 2000);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes.buffer);
      TestRunner.assert.equal(workbook.creator, 'UmaFicStudio');
      const sheet = workbook.worksheets.find(ws => ws.name.includes('R9 Export Horse'));
      TestRunner.assert.ok(sheet);
      const values = [];
      sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.value ?? ''))));
      TestRunner.assert.ok(values.includes('基本信息'));
      TestRunner.assert.ok(values.includes('R9 Export Horse'));
      TestRunner.assert.ok(values.includes('五代血统表'));
      TestRunner.assert.ok(values.includes('比赛记录'));
      TestRunner.assert.ok(values.includes('肩高(cm)'));
      TestRunner.assert.ok(values.includes('163.5'));
      TestRunner.assert.ok(values.includes('马体重(增减)'));
      TestRunner.assert.ok(values.includes('480(0)'));
      TestRunner.assert.ok(values.includes('490(+10)'));
      TestRunner.assert.ok(values.includes('488(-2)'));
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
      await Storage._deleteRaw('horses', horseId);
      for (const id of resultIds) await Storage._deleteRaw('results', id);
    }
  });
});
