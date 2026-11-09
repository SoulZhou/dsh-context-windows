# dsh-context-windows

A DeepSeek Harness client plugin that adds a **Settings → 模型上下文窗口 / Model Context
Windows** page, giving WorkBuddy and Trae the same per-model visual context-window
adjustment that Qoder CN has under its own Settings section.

## What it does

- Lists the models of each connected WorkBuddy / Trae region on one page.
- For each model, offers a `<select>` of context-window sizes (plus a "default /
  follow upstream" option that clears the override).
- Writes the chosen value into the connector's existing `contextBudgets` config
  field via the Host settings service, so the set value actually takes effect
  in `applyContextBudgets`.
- Re-fetches the model roster after each write, so the effective (advertised)
  window proves the change round-tripped.
- Bilingual (zh / en) via the Host locale service; uses proven theme tokens and
  self-paints an opaque background so it is readable on glass themes.

## Honest limitations (stated in the UI)

A budget only changes the **context window DSH advertises** for the model, which
drives **auto-compression timing**. It does **not** change the window the upstream
service actually serves for a request.

- **WorkBuddy** applies `Math.min(native, budget)`: any positive value at or
  below the native window is effective, so the page offers a graded "turn it
  down" ladder.
- **Trae** accepts only its own declared ladder (`dev` / `500K` when
  `Max >= 500K` / `Max`). A model that declares no `Max` window has a single
  option and is shown as **read-only** rather than offering a no-op control.
- **Qoder CN** is left to its own Settings page (it already has this feature).

## Structure

| File | Role |
| --- | --- |
| `index.js` | Host half: `settings.section`-agnostic loopback routes `GET /plugins/dsh-context-windows/state` and `POST /plugins/dsh-context-windows/set` that read/write `regions[panel].contextBudgets` through `settings.describe()` / `settings.mutate()`. |
| `client.js` | Browser half: registers the `settings.section` page and renders the visual controls. |
| `cordis.patch.yml` | Inserts the bundle into the profile patch. |
| `locale/zh.json`, `locale/en.json` | Host display metadata (`meta.title`, `meta.description`). |
| `icon.svg` | Settings icon. |

The client reads model rosters from each connector's own proven routes:

- `/plugins/dsh-connect-workbuddy/usage?region=cn|global`
- `/plugins/dsh-connect-trae/usage?region=cn|enterprise|ai&detail=fast`

## Install

Add the plugin to the desktop profile with the DSH CLI:

```powershell
dsh plugin --profile desktop add D:\path\to\dsh-context-windows
```

Or install the published package from GitHub:

```powershell
dsh plugin --profile desktop add github:SoulZhou/dsh-context-windows
```

A **full quit and reopen** of the DSH desktop app is required for the Host half
to load; `Ctrl+R` only reloads the renderer. See the `dsh-client-plugin` skill for
the full backup / verification procedure.

After installing, open **Settings → 模型上下文窗口 / Model Context Windows** to
adjust each connected WorkBuddy / Trae model.

## Changelog

- **1.0.1** — First public release: added repository metadata, LICENSE, a
  full-canvas 512×512 icon, and explicit install instructions.
- **1.0.0** — Initial internal build and verification.
