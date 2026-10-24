/**
 * Scene Rhythm Card for Home Assistant
 *
 * A thin, single-row card that shows the previous / current / next scene
 * scene (e.g. of an aquarium light) on a 24h timeline, with arrows to step
 * backward/forward.
 *
 * The "current scene" lives in an input_select helper. The card only changes
 * that helper; an automation applies the matching scene whenever the helper
 * changes (see examples/aquarium_package.yaml).
 */
const VERSION = '1.1.0';

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

class SceneRhythmCard extends HTMLElement {
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
      throw new Error('Set `entity` to an input_select helper (e.g. input_select.reef_light_scene)');
    }
    if (config.scenes && !Array.isArray(config.scenes)) {
      throw new Error('`scenes` must be a list');
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

  static getConfigElement() {
    return document.createElement('scene-rhythm-card-editor');
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((e) => e.startsWith('input_select.'));
    return { entity: entity || 'input_select.reef_light_scene' };
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

  _scenes(stateObj) {
    const options = stateObj.attributes.options || [];
    // The helper's options define which scenes exist and their order; `scenes`
    // entries only add a label/time/color to the option they name.
    const overrides = new Map(
      (this._config.scenes || [])
        .map((s) => (typeof s === 'string' ? { option: s } : s))
        .map((s) => [String(s.option), s]),
    );
    const src = (options.length ? options : [...overrides.keys()]).map((option) => ({
      ...overrides.get(String(option)),
      option,
    }));
    // Options that are themselves times (e.g. "13:00") double as the scene time.
    const scenes = src.map((s, i) => ({
      option: String(s.option),
      label: s.label || String(s.option),
      start: toMinutes(s.time || s.option),
      color: s.color || PALETTE[i % PALETTE.length],
    }));
    const timed = scenes.length > 0 && scenes.every((s) => s.start != null);
    if (timed) scenes.sort((a, b) => a.start - b.start);
    return { scenes, timed };
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

    const { scenes, timed } = this._scenes(stateObj);
    const n = scenes.length;
    if (!n) {
      this._paint(`<div class="warn">No scenes for ${esc(cfg.entity)}</div>`);
      return;
    }

    const curIdx = scenes.findIndex((s) => s.option === stateObj.state);
    const prev = scenes[curIdx < 0 ? n - 1 : (curIdx - 1 + n) % n];
    const next = scenes[curIdx < 0 ? 0 : (curIdx + 1) % n];
    const cur = curIdx >= 0 ? scenes[curIdx] : { option: stateObj.state, label: stateObj.state, color: 'var(--disabled-text-color)' };

    // Which scene the schedule says should be active right now (wraps past midnight).
    // schedule_offset accounts for automations that fire a few minutes after the scene time.
    const offset = Number(cfg.schedule_offset) || 0;
    let schedIdx = -1;
    if (timed) {
      schedIdx = n - 1;
      scenes.forEach((s, i) => {
        if (s.start + offset <= now) schedIdx = i;
      });
    }
    const offSchedule = timed && cfg.show_manual !== false && schedIdx !== curIdx;

    // Build bar segments.
    const segs = [];
    scenes.forEach((s, i) => {
      const cls = i === curIdx ? 'seg cur' : 'seg';
      const attrs = `class="${cls}" data-option="${esc(s.option)}" title="${esc(s.label)}${timed ? ' · ' + fmtTime(s.start) : ''}" style="background:${esc(s.color)};`;
      if (!timed) {
        segs.push(`<div ${attrs}left:${(i / n) * 100}%;width:${100 / n}%"></div>`);
        return;
      }
      const start = s.start;
      const end = n === 1 ? start + DAY : scenes[(i + 1) % n].start;
      const ranges = end > start ? [[start, end]] : [[start, DAY], [0, end]];
      for (const [a, b] of ranges) {
        if (b <= a) continue;
        segs.push(`<div ${attrs}left:${(a / DAY) * 100}%;width:${((b - a) / DAY) * 100}%"></div>`);
      }
    });

    // Skip the time when the label already is that time (unlabelled "HH:MM" options).
    const time = (s) =>
      timed && cfg.show_times !== false && s.label !== fmtTime(s.start)
        ? `<span class="t">${fmtTime(s.start)}</span>`
        : '';
    const name = cfg.name ? `<span class="name">${esc(cfg.name)}</span>` : '';
    const badge = offSchedule
      ? `<span class="badge" data-option="${esc(scenes[schedIdx].option)}" title="Schedule says ${esc(scenes[schedIdx].label)} — tap to resume">manual</span>`
      : '';

    this._paint(`
      <div class="row">
        <button class="nav" data-option="${esc(prev.option)}" title="Back to ${esc(prev.label)}" aria-label="Previous scene">
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
        <button class="nav" data-option="${esc(next.option)}" title="Forward to ${esc(next.label)}" aria-label="Next scene">
          <svg viewBox="0 0 24 24"><path d="${CHEVRON_RIGHT}"/></svg>
        </button>
      </div>`);
  }

  _paint(body) {
    this.shadowRoot.innerHTML = `<style>${SceneRhythmCard.styles}</style><ha-card>${body}</ha-card>`;
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

const EDITOR_SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: 'input_select' } } },
  { name: 'name', selector: { text: {} } },
  {
    type: 'grid',
    name: '',
    flatten: true,
    schema: [
      { name: 'show_times', selector: { boolean: {} } },
      { name: 'show_manual', selector: { boolean: {} } },
    ],
  },
  { name: 'schedule_offset', selector: { number: { min: 0, max: 59, mode: 'box', unit_of_measurement: 'min' } } },
];
const EDITOR_LABELS = {
  entity: 'Scene helper (dropdown)',
  name: 'Name',
  show_times: 'Show times',
  show_manual: 'Show MANUAL badge',
  schedule_offset: 'Schedule offset (minutes after each scene time)',
};

/**
 * Visual editor. The top half is HA's own ha-form; the scene list is built from
 * the helper's options so each scene only needs a time, label and color.
 * The DOM is rebuilt only when the helper or its options change, so inputs keep
 * focus while typing.
 */
class SceneRhythmCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._key = null;
  }

  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _options() {
    return this._hass?.states[this._config?.entity]?.attributes.options || [];
  }

  _update() {
    if (!this._config || !this._hass) return;
    const key = `${this._config.entity}|${this._options().join('\u0001')}`;
    if (key !== this._key) {
      this._key = key;
      this._build();
    }
    this._form.hass = this._hass;
    this._form.data = {
      ...this._config,
      show_times: this._config.show_times !== false,
      show_manual: this._config.show_manual !== false,
    };
  }

  _build() {
    const options = this._options();
    const byOption = new Map(
      (this._config.scenes || [])
        .map((s) => (typeof s === 'string' ? { option: s } : s))
        .map((s) => [String(s.option), s]),
    );
    this._rows = options.map((option) => ({ option, ...(byOption.get(option) || {}) }));

    this.shadowRoot.innerHTML = `<style>${SceneRhythmCardEditor.styles}</style>`;
    this._form = document.createElement('ha-form');
    this._form.schema = EDITOR_SCHEMA;
    this._form.computeLabel = (s) => EDITOR_LABELS[s.name] ?? s.name;
    this._form.addEventListener('value-changed', (ev) => this._formChanged(ev.detail.value));
    this.shadowRoot.appendChild(this._form);

    const section = document.createElement('div');
    section.className = 'scenes';
    if (!this._config.entity) {
      section.innerHTML = `<p class="hint">Pick a dropdown helper to set up its scenes.</p>`;
    } else if (!options.length) {
      section.innerHTML = `<p class="hint">That helper has no options yet.</p>`;
    } else {
      section.innerHTML = `
        <div class="head">Scenes</div>
        <p class="hint">Give every scene a time to draw the 24-hour timeline. Options named like
          <code>13:00</code> use that time automatically.</p>
        <div class="grid">
          <span class="col">Option</span><span class="col">Time</span>
          <span class="col">Label</span><span class="col">Color</span>
          ${this._rows
            .map(
              (r, i) => `
            <span class="opt" title="${esc(r.option)}">${esc(r.option)}</span>
            <input type="time" data-i="${i}" data-f="time" value="${esc(r.time || (toMinutes(r.option) != null ? fmtTime(toMinutes(r.option)) : ''))}">
            <input type="text" data-i="${i}" data-f="label" value="${esc(r.label || '')}" placeholder="${esc(r.option)}">
            <input type="color" data-i="${i}" data-f="color" value="${esc(r.color || PALETTE[i % PALETTE.length])}">`,
            )
            .join('')}
        </div>`;
      section.addEventListener('input', (ev) => this._sceneChanged(ev));
      section.addEventListener('change', (ev) => this._sceneChanged(ev));
    }
    this.shadowRoot.appendChild(section);
  }

  _formChanged(value) {
    const config = { ...this._config, ...value };
    if (config.show_times !== false) delete config.show_times;
    if (config.show_manual !== false) delete config.show_manual;
    if (!config.schedule_offset) delete config.schedule_offset;
    if (!config.name) delete config.name;
    if (config.entity !== this._config.entity) delete config.scenes;
    this._fire(config);
  }

  _sceneChanged(ev) {
    const el = ev.target;
    if (el.dataset.i == null) return;
    // Color pickers fire "input" continuously while dragging; only commit on "change".
    if (el.type === 'color' && ev.type === 'input') return;
    const row = this._rows[Number(el.dataset.i)];
    row[el.dataset.f] = el.value;

    // Only store what differs from the defaults, so a helper with "HH:MM" options and
    // no customisation yields no `scenes` key at all.
    const scenes = this._rows.map((r) => {
      const s = { option: r.option };
      const inferred = toMinutes(r.option);
      if (r.time && (inferred == null || toMinutes(r.time) !== inferred)) s.time = r.time;
      if (r.label) s.label = r.label;
      if (r.color) s.color = r.color;
      return s;
    });
    const config = { ...this._config };
    if (scenes.some((s) => Object.keys(s).length > 1)) config.scenes = scenes;
    else delete config.scenes;
    this._fire(config);
  }

  _fire(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  static get styles() {
    return `
      :host { display: block; }
      .scenes { margin-top: 16px; }
      .head { font-weight: 500; font-size: 15px; margin-bottom: 4px; color: var(--primary-text-color); }
      .hint { margin: 0 0 10px; font-size: 13px; color: var(--secondary-text-color); }
      code { font-size: 12px; }
      .grid {
        display: grid; grid-template-columns: minmax(48px, auto) 112px minmax(0, 1fr) 40px;
        gap: 6px 8px; align-items: center;
      }
      .col { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
      .opt { font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      input {
        box-sizing: border-box; width: 100%; height: 36px; padding: 0 8px; font: inherit; font-size: 14px;
        color: var(--primary-text-color); background: var(--input-fill-color, var(--secondary-background-color));
        border: 1px solid var(--divider-color); border-radius: 6px;
      }
      input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
      input[type="color"] { padding: 2px; cursor: pointer; }
    `;
  }
}

if (!customElements.get('scene-rhythm-card-editor')) {
  customElements.define('scene-rhythm-card-editor', SceneRhythmCardEditor);
}

if (!customElements.get('scene-rhythm-card')) {
  customElements.define('scene-rhythm-card', SceneRhythmCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'scene-rhythm-card',
    name: 'Scene Rhythm',
    description: 'Thin day timeline of scenes with prev/next arrows.',
    preview: true,
  });
  console.info(`%c SCENE-RHYTHM-CARD %c v${VERSION} `, 'background:#0ea5e9;color:#fff', '');
}
