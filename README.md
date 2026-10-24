# ha-scene-rhythm-card

A thin Home Assistant Lovelace card that shows a scene schedule as a timeline across the day. Built for aquarium lights, but it works for any set of scenes that follow a daily rhythm.

```
 ‹   Dawn 07:00        Reef ● Midday         18:00 Sunset   ›
     ▁▁▁▁▁▁▁▁▁▁▁▁████████████▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
```

- **‹ / ›** step to the previous or next scene. Tapping a label or a bar segment jumps straight to that scene.
- The highlighted segment is the current scene. The vertical tick marks the current time.
- A **MANUAL** badge appears when the current scene differs from what the schedule says should be active now. Tap it to go back to the schedule.
- Tap the current scene name to open the helper's more-info dialog.

## How "current scene" works

Home Assistant doesn't track which scene is active, so this card uses a **dropdown (`input_select`) helper as the source of truth**:

1. **Helper:** one dropdown per tank, with one option per scene.
2. **Schedule automation:** at each time, *sets the helper* (instead of calling `scene.turn_on`).
3. **Apply automation:** whenever the helper changes, it turns on the matching scene.
4. **Card:** the arrows also just set the helper.

Every change, whether scheduled or manual, goes through the same path, so the card always shows what is actually applied. See [`examples/aquarium_package.yaml`](examples/aquarium_package.yaml).

## Install

**HACS (custom repository):** HACS → ⋮ → Custom repositories → add this repo as type *Dashboard* → install.

**Manual:** copy `ha-scene-rhythm-card.js` to `/config/www/`, then go to Settings → Dashboards → ⋮ → Resources → Add:
`/local/ha-scene-rhythm-card.js` (JavaScript module).

## Setup

Add the card from the dashboard editor (search for **Scene Rhythm**) and configure it visually:

1. Pick the dropdown helper.
2. Give each scene a time, a label and a colour. Option names that are already times, such as `13:00`, are used as the time automatically, so a helper with options like `11:00, 13:00, 15:00` needs no scene setup at all.

### YAML

```yaml
type: custom:scene-rhythm-card
entity: input_select.reef_light_scene
name: Reef
scenes:
  - { option: Dawn,      time: "07:00", color: "#f59e0b" }
  - { option: Morning,   time: "09:00", color: "#fde047" }
  - { option: Midday,    time: "12:00", color: "#38bdf8" }
  - { option: Sunset,    time: "18:00", color: "#f97316" }
  - { option: Moonlight, time: "20:30", color: "#6366f1" }
  - { option: Night,     time: "23:00", color: "#1e1b4b" }
```

| Option | Default | Description |
|---|---|---|
| `entity` | **required** | `input_select` helper holding the current scene |
| `name` | none | Small label shown before the current scene |
| `scenes` | none | Per-option overrides: `option` (must match a helper option), plus optional `time` (`HH:MM`), `label` and `color`. The helper's options always decide which scenes exist and their order. If any scene has no time, segments are drawn at equal widths with no "now" tick. (`stages` is accepted as an older name.) |
| `show_times` | `true` | Show start times beside the previous and next scenes |
| `show_manual` | `true` | Show the MANUAL badge when the scene differs from the schedule |
| `schedule_offset` | `0` | Minutes after each scene time that your automation actually fires, so the MANUAL badge doesn't flash during the gap |

Stack one card per tank in a vertical stack. Each card is about 44 px tall.

> Scene times are written in both the card config and the schedule automation. Keep them in sync.
