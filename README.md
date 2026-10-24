# ha-scene-rhythm-card

A thin Home Assistant Lovelace card that shows a scene schedule as a timeline across the day. Built for aquarium lights, but it works for any set of scenes that follow a daily rhythm.

```
 ‹   Dawn 07:00        Reef ● Midday         18:00 Sunset   ›
     ▁▁▁▁▁▁▁▁▁▁▁▁████████████▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
```

- **‹ / ›** step to the previous or next stage. Tapping a label or a bar segment jumps straight to that stage.
- The highlighted segment is the current stage. The vertical tick marks the current time.
- A **MANUAL** badge appears when the current stage differs from what the schedule says should be active now. Tap it to go back to the schedule.
- Tap the current stage name to open the helper's more-info dialog.

## How "current scene" works

Home Assistant doesn't track which scene is active, so this card uses an **`input_select` helper as the source of truth**:

1. **Helper:** one `input_select` per tank, with one option per stage.
2. **Schedule automation:** at each time, *sets the helper* (instead of calling `scene.turn_on`).
3. **Apply automation:** whenever the helper changes, it turns on the matching scene.
4. **Card:** the arrows also just set the helper.

Every change, whether scheduled or manual, goes through the same path, so the card always shows what is actually applied. See [`examples/aquarium_package.yaml`](examples/aquarium_package.yaml).

## Install

**HACS (custom repository):** HACS → ⋮ → Custom repositories → add this repo as type *Dashboard* → install.

**Manual:** copy `ha-scene-rhythm-card.js` to `/config/www/`, then go to Settings → Dashboards → ⋮ → Resources → Add:
`/local/ha-scene-rhythm-card.js` (JavaScript module).

## Config

```yaml
type: custom:scene-rhythm-card
entity: input_select.reef_light_stage
name: Reef
stages:
  - { option: Dawn,      time: "07:00", color: "#f59e0b" }
  - { option: Morning,   time: "09:00", color: "#fde047" }
  - { option: Midday,    time: "12:00", color: "#38bdf8" }
  - { option: Sunset,    time: "18:00", color: "#f97316" }
  - { option: Moonlight, time: "20:30", color: "#6366f1" }
  - { option: Night,     time: "23:00", color: "#1e1b4b" }
```

| Option | Default | Description |
|---|---|---|
| `entity` | **required** | `input_select` helper holding the current stage |
| `name` | none | Small label shown before the current stage |
| `stages` | helper options | List of stages. Each stage has `option` (must match a helper option), plus optional `time` (`HH:MM`), `color` and `label`. Stages are sorted by time. If any stage has no time, segments are drawn at equal widths with no "now" tick. |
| `show_times` | `true` | Show start times beside the previous and next stages |
| `show_manual` | `true` | Show the MANUAL badge when the stage differs from the schedule |
| `schedule_offset` | `0` | Minutes after each stage time that your automation actually fires, so the MANUAL badge doesn't flash during the gap |

Stack one card per tank in a vertical stack. Each card is about 44 px tall.

> Stage times are written in both the card config and the schedule automation. Keep them in sync.
