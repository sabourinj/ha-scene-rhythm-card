/**
 * Scene Rythm Card for Home Assistant
 *
 * A thin, single-row card that shows the previous / current / next scene
 * stage (e.g. of an aquarium light) on a 24h timeline, with arrows to step
 * backward/forward.
 *
 * The "current stage" lives in an input_select helper. The card only changes
 * that helper; an automation applies the matching scene whenever the helper
 * changes (see examples/aquarium_package.yaml).
 */
const VERSION = '1.0.0';

const PALETTE = ['#312e81', '#f59e0b', '#fde047', '#38bdf8', '#f97316', '#6366f1', '#14b8a6', '#ec4899'];
const CHEVRON_LEFT = 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z';
const CHEVRON_RIGHT = 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z';
const DAY = 1440;

const toMinutes = (t) => {
  if (t == null) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? (Number(m[1]) * 60 + Number(m[2])) % DAY : null;
};
const fmtTime = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class SceneRythmCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._sig = '';
    this.shadowRoot.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-option], [data-more-info]');
      if (!el) return;
      if (el.dataset.option != null) this._select(el.dataset.option);
      else this._moreInfo();
    });
  }

  setConfig(config) {
    if (!config || !String(config.entity || '').startsWith('input_select.')) {
      throw new Error('Set `entity` to an input_select helper (e.g. input_select.reef_light_stage)');
    }
    if (config.stages && !Array.isArray(config.stages)) {
      throw new Error('`stages` must be a list');
    }
    this._config = config;
    this._sig = '';
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    // Keep the "now" marker and off-schedule badge fresh even without state changes.
    this._timer = setInterval(() => this._render(), 30000);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: 12, rows: 1, min_rows: 1 };
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((e) => e.startsWith('input_select.'));
    return { entity: entity || 'input_select.reef_light_stage' };
  }

  _nowMinutes() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: this._hass?.config?.time_zone,
      }).formatToParts(new Date());
      const get = (type) => Number(parts.find((p) => p.type === type).value);
      return get('hour') * 60 + get('minute');
    } catch (e) {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  _stages(stateObj) {
    const options = stateObj.attributes.options || [];
    const src = this._config.stages
      ? this._config.stages.map((s) => (typeof s === 'string' ? { option: s } : s))
      : options.map((option) => ({ option }));
    const stages = src.map((s, i) => ({
      option: String(s.option),
      label: s.label ?? String(s.option),
      start: toMinutes(s.time),
      color: s.color || PALETTE[i % PALETTE.length],
    }));
    const timed = stages.length > 0 && stages.every((s) => s.start != null);
    if (timed) stages.sort((a, b) => a.start - b.start);
    return { stages, timed };
  }

  _select(option) {
    if (!this._hass || !this._config) return;
    this._hass.callService('input_select', 'select_option', {
      entity_id: this._config.entity,
      option,
    });
  }

  _moreInfo() {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId: this._config.entity },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    const stateObj = this._hass.states[cfg.entity];
    const now = this._nowMinutes();

    const sig = `${stateObj?.state}|${(stateObj?.attributes.options || []).join(',')}|${now}`;
    if (sig === this._sig) return;
    this._sig = sig;

    if (!stateObj) {
      this._paint(`<div class="warn">Entity not found: ${esc(cfg.entity)}</div>`);
      return;
    }

    const { stages, timed } = this._stages(stateObj);
    const n = stages.length;
    if (!n) {
      this._paint(`<div class="warn">No stages for ${esc(cfg.entity)}</div>`);
      return;
    }

    const curIdx = stages.findIndex((s) => s.option === stateObj.state);
    const prev = stages[curIdx < 0 ? n - 1 : (curIdx - 1 + n) % n];
    const next = stages[curIdx < 0 ? 0 : (curIdx + 1) % n];
    const cur = curIdx >= 0 ? stages[curIdx] : { option: stateObj.state, label: stateObj.state, color: 'var(--disabled-text-color)' };

    // Which stage the schedule says should be active right now (wraps past midnight).
    // schedule_offset accounts for automations that fire a few minutes after the stage time.
    const offset = Number(cfg.schedule_offset) || 0;
    let schedIdx = -1;
    if (timed) {
      schedIdx = n - 1;
      stages.forEach((s, i) => {
        if (s.start + offset <= now) schedIdx = i;
      });
    }
    const offSchedule = timed && cfg.show_manual !== false && schedIdx !== curIdx;

    // Build bar segments.
    const segs = [];
    stages.forEach((s, i) => {
      const cls = i === curIdx ? 'seg cur' : 'seg';
      const attrs = `class="${cls}" data-option="${esc(s.option)}" title="${esc(s.label)}${timed ? ' · ' + fmtTime(s.start) : ''}" style="background:${esc(s.color)};`;
      if (!timed) {
        segs.push(`<div ${attrs}left:${(i / n) * 100}%;width:${100 / n}%"></div>`);
        return;
      }
      const start = s.start;
      const end = n === 1 ? start + DAY : stages[(i + 1) % n].start;
      const ranges = end > start ? [[start, end]] : [[start, DAY], [0, end]];
      for (const [a, b] of ranges) {
        if (b <= a) continue;
        segs.push(`<div ${attrs}left:${(a / DAY) * 100}%;width:${((b - a) / DAY) * 100}%"></div>`);
      }
    });

    const time = (s) => (timed && cfg.show_times !== false ? `<span class="t">${fmtTime(s.start)}</span>` : '');
    const name = cfg.name ? `<span class="name">${esc(cfg.name)}</span>` : '';
    const badge = offSchedule
      ? `<span class="badge" data-option="${esc(stages[schedIdx].option)}" title="Schedule says ${esc(stages[schedIdx].label)} — tap to resume">manual</span>`
      : '';

    this._paint(`
      <div class="row">
        <button class="nav" data-option="${esc(prev.option)}" title="Back to ${esc(prev.label)}" aria-label="Previous stage">
          <svg viewBox="0 0 24 24"><path d="${CHEVRON_LEFT}"/></svg>
        </button>
        <div class="mid">
          <div class="labels">
            <span class="side prev" data-option="${esc(prev.option)}">${esc(prev.label)}${time(prev)}</span>
            <span class="cur">
              ${name}
              <span class="dot" style="background:${esc(cur.color)}"></span>
              <span class="curlabel" data-more-info>${esc(cur.label)}</span>
              ${badge}
            </span>
            <span class="side next" data-option="${esc(next.option)}">${time(next)}${esc(next.label)}</span>
          </div>
          <div class="bar">
            <div class="track">${segs.join('')}</div>
            ${timed ? `<div class="now" style="left:${(now / DAY) * 100}%"></div>` : ''}
          </div>
        </div>
        <button class="nav" data-option="${esc(next.option)}" title="Forward to ${esc(next.label)}" aria-label="Next stage">
          <svg viewBox="0 0 24 24"><path d="${CHEVRON_RIGHT}"/></svg>
        </button>
      </div>`);
  }

  _paint(body) {
    this.shadowRoot.innerHTML = `<style>${SceneRythmCard.styles}</style><ha-card>${body}</ha-card>`;
  }

  static get styles() {
    return `
      :host { display: block; }
      ha-card { padding: 4px 2px; overflow: hidden; }
      .row { display: flex; align-items: center; gap: 2px; }
      .nav {
        flex: 0 0 auto; width: 32px; height: 36px; padding: 0;
        display: grid; place-items: center;
        border: none; border-radius: 8px; background: none; cursor: pointer;
        color: var(--secondary-text-color);
      }
      .nav:hover { background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--primary-text-color); }
      .nav svg { width: 22px; height: 22px; fill: currentColor; }
      .mid { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; padding: 2px 0; }
      .labels {
        display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr);
        align-items: center; gap: 8px; font-size: 12px; line-height: 16px;
      }
      .side {
        min-width: 0; color: var(--secondary-text-color); cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .side:hover { color: var(--primary-text-color); }
      .side.next { text-align: right; }
      .t { opacity: .65; font-variant-numeric: tabular-nums; margin: 0 4px; }
      .cur {
        display: flex; align-items: center; gap: 6px; white-space: nowrap;
        font-size: 13px; font-weight: 600; color: var(--primary-text-color);
      }
      .curlabel { cursor: pointer; }
      .name { font-weight: 400; color: var(--secondary-text-color); }
      .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
      .badge {
        font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
        line-height: 14px; padding: 0 5px; border-radius: 7px; cursor: pointer;
        background: var(--warning-color, #f59e0b); color: #000;
      }
      .bar { position: relative; height: 6px; }
      .track {
        position: absolute; inset: 0; border-radius: 3px; overflow: hidden;
        background: var(--divider-color, rgba(127,127,127,.2));
      }
      .seg {
        position: absolute; top: 0; bottom: 0; opacity: .3; cursor: pointer;
        box-shadow: inset -1px 0 0 var(--ha-card-background, var(--card-background-color, #fff));
        transition: opacity .2s;
      }
      .seg:hover { opacity: .6; }
      .seg.cur { opacity: 1; }
      .now {
        position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px;
        border-radius: 1px; pointer-events: none;
        background: var(--primary-text-color);
        box-shadow: 0 0 0 1px var(--ha-card-background, var(--card-background-color, #fff));
      }
      .warn { padding: 10px 12px; color: var(--error-color, #db4437); font-size: 13px; }
    `;
  }
}

if (!customElements.get('scene-rythm-card')) {
  customElements.define('scene-rythm-card', SceneRythmCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'scene-rythm-card',
    name: 'Scene Rythm',
    description: 'Thin day timeline of scene stages with prev/next arrows.',
    preview: true,
  });
  console.info(`%c SCENE-RYTHM-CARD %c v${VERSION} `, 'background:#0ea5e9;color:#fff', '');
}
