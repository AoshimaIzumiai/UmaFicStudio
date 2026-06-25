/* ui-timeline.js — 时间线视图（生涯节点） */
'use strict';

const UITimeline = {
  _icons: { birth: '🐴', debut: '🏁', retired: '🏠', stallion: '♂', broodmare: '♀', other: '🔄', deceased: '✝' },
  _colors: { birth: 'birth', debut: 'race', retired: 'retired', stallion: 'stud', broodmare: 'broodmare', other: 'retired', deceased: 'deceased' },

  async init() {
    const events = await this._collectEvents();
    this._render(events);
  },

  async _collectEvents() {
    const events = [];
    const horses = await Storage.getAllHorses();
    const fictional = horses.filter(h => h.type === 'fictional');
    const results = await Storage.getAllEntities('results');

    for (const h of fictional) {
      const name = Utils.displayName(h);
      // 出生
      if (h.birth_year) {
        events.push({ year: h.birth_year, type: 'birth', text: name, detail: h.country || '' });
      }
      // 出道：该马最早一场比赛的年份
      let debutYear = null;
      let debutDetail = '';
      for (const r of results) {
        if (!r.year) continue;
        const entry = (r.entries || []).find(e => e.horse_id === h.id);
        if (entry && (!debutYear || r.year < debutYear)) {
          debutYear = r.year;
          debutDetail = (r.race_name || '') + ' 第' + (entry.finish || '?') + '名';
        }
      }
      if (debutYear) {
        events.push({ year: debutYear, type: 'debut', text: name, detail: debutDetail });
      }
      // 用途变更记录
      if (h.career_events) {
        for (const e of h.career_events) {
          if (e.year) {
            events.push({ year: e.year, type: e.type, text: name, detail: e.note || '' });
          }
        }
      }
    }

    events.sort((a, b) => (a.year || 0) - (b.year || 0));
    return events;
  },

  _render(events) {
    const container = document.getElementById('timeline-content');
    if (!events.length) {
      container.innerHTML = `<div class="timeline-empty">${I18N.t('timelineEmpty')}</div>`;
      return;
    }

    const grouped = {};
    for (const ev of events) {
      const y = ev.year || '?';
      if (!grouped[y]) grouped[y] = [];
      grouped[y].push(ev);
    }

    const labels = { birth: I18N.t('timelineBirth'), debut: I18N.t('careerDebut'), retired: I18N.t('careerRetired'), stallion: I18N.t('careerStallion'), broodmare: I18N.t('careerBroodmare'), other: I18N.t('careerOther'), deceased: I18N.t('careerDeceased') };

    let html = '<div class="timeline-container">';
    for (const year of Object.keys(grouped)) {
      html += `<div class="timeline-year">${year}</div><div class="timeline-events">`;
      for (const ev of grouped[year]) {
        const icon = this._icons[ev.type] || '•';
        const colorClass = this._colors[ev.type] || 'birth';
        const label = labels[ev.type] || ev.type;
        html += `<div class="timeline-card"><span class="timeline-icon ${colorClass}">${icon}</span><span class="timeline-text"><b>${ev.text}</b> ${label}</span><span class="timeline-detail">${ev.detail}</span></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }
};
