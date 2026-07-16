# Brand

FreeAI Open uses a calm, technical visual identity for a local-first browser AI tool. The brand should communicate privacy by design, user control, open-source work, and practical device-level execution without using generic AI imagery.

## Logo Usage

The current production web assets are derived from the square dark app icon:

- `apps/web/public/brand/freeai-open-app-icon.png`
- `apps/web/public/brand/favicon.png`
- `apps/web/public/brand/apple-touch-icon.png`
- `apps/web/public/brand/pwa-icon-192.png`
- `apps/web/public/brand/pwa-icon-512.png`

Compact navigation should use the square symbol asset and render `FreeAI Open` as real HTML text. Do not use the large horizontal raster reference image inside the product interface.

Do not distort, recolor, rotate, add glow, add metallic texture, or add strong shadow to the logo. Keep clear space around the symbol and use it as an identity mark, not as a repeated decorative pattern.

Known limitation: the current public assets are PNGs. A true vector reconstruction of the logo is still required before broad brand distribution, press kits, or high-resolution print usage.

## Color Tokens

The source palette is implemented in `apps/web/app/globals.css` as `--fo-*` tokens:

- Ink 950: `#0D1118`
- Ink 900: `#171C25`
- Open Teal 500: `#00D8AB`
- Open Teal 700: `#00A985`
- Open Teal 100: `#D9F8F0`
- Paper 50: `#FDFBF9`
- Surface 100: `#F4F6F7`
- Slate 700: `#3E4247`
- Muted 500: `#707781`
- Line 200: `#DDE1E5`

Use semantic tokens such as `--fo-bg`, `--fo-surface`, `--fo-text`, `--fo-text-muted`, `--fo-border`, `--fo-accent`, `--fo-accent-soft`, and `--fo-focus` in product CSS. The legacy `--color-*` aliases remain as compatibility shims while the UI migrates gradually.

## Accent Discipline

Use teal sparingly. It should indicate active/local/ready/confirmed states and focus, not every title, border, icon, or decorative element. Primary buttons use Ink backgrounds with Paper text; teal is reserved for focus, active state, or confirmed local state.

**The 80/15/5 rule:** roughly 80% of any screen should be light or dark neutrals, 15% secondary surfaces (cards, panels), and no more than 5% teal. The accent stays rare on purpose — that scarcity is what gives it meaning.

## Typography

Use:

- Sans: `Inter, ui-sans-serif, system-ui, sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Consolas, monospace`

No runtime third-party font CDN is used. If Inter is unavailable, the browser falls back to system fonts.

| Level   | Font / weight       | Line height | Usage                              |
| ------- | -------------------- | ----------- | ----------------------------------- |
| Display | Inter Display 700    | 1.00–1.08   | Hero moments and strong announcements (`.fo-display`). |
| H1      | Inter Display 700    | 1.10        | Main page title (`.fo-page-title`). |
| H2      | Inter Display 650/700 | 1.15       | Sections and large panels.          |
| H3      | Inter 600            | 1.25        | Cards and functional groups.        |
| Body    | Inter 400            | 1.50–1.65   | Regular text and documentation.     |
| Label   | Inter 600, uppercase | 1.20        | Over-titles, states, small categories (`.fo-kicker`, `.fo-technical-label`). |
| Code    | Monospace 400        | 1.50        | Tokens, logs, model IDs, paths, timings (`.fo-technical-value`). |

## Component Treatment

- **Primary button:** Ink background, Paper text (`.fo-button-primary`). Teal is reserved for focus, active state, or a confirmed local action — never the default button fill.
- **Secondary button:** light surface, Line/border-token border, Ink/text-token text (`.fo-button-secondary`).
- **Field:** Paper/white background, a discreet border, and a 2px Open Teal 500 focus ring.
- **Card:** `--fo-surface` or white, a light border, 16px radius, no decorative shadow (`.fo-card`). Shadows are reserved for real overlays — drawers, floating controls, dropdown menus (`--fo-shadow-float`).
- **Active local state:** a Teal Soft chip or panel with Teal 700 text (`--fo-accent-soft` / `--fo-accent-strong`). Avoid a generic "success green" — teal carries this meaning on its own.
- **Logs / diagnostic surfaces:** Ink 950 background, Paper-colored code, muted metadata, measured (not alarming) red for errors. See `.fo-ink-surface` for how this is implemented as a scoped token override so the rest of the design system keeps working inside it.

## Imagery

**Prefer:** clean product screenshots cropped to one identifiable action; sober photography of real devices (GPU, laptop, screen, desk); simple technical diagrams showing local data flow and user choices; light material textures (paper, matte aluminum, frosted glass) used only as background; readable charts with clear values, units, period, and source.

**Exclude:** glowing/luminous brains, humanoid robots, synthetic faces, cybernetic eyes, decorative neural-network graphics, blue circuit patterns, galaxies, green "code matrix" effects, purple/blue gradients used as a visual shorthand for "AI", and any image implying a feature or performance level that isn't actually implemented or measured.

Every image should add proof, an explanation, or context — a purely decorative "tech" image with no information weakens the brand rather than strengthening it.

## Editorial Tone

Direct, factual, and calm. Explain limits as readily as capabilities; no marketing superlatives, no dramatization, no anthropomorphizing the model.

| Say | Avoid |
| --- | --- |
| "The model runs on this device." | "Your limitless intelligence." |
| "Estimated memory: 5.2 GB." | "Revolutionary optimization." |
| "No data sent." | "Absolute guaranteed privacy." |
| "This model may be slower on your device." | "An ultra-fast experience for everyone." |
| "Reload the model." | "Reset the AI's brain." |

- Short sentences, concrete verbs.
- Technical information is visible on demand, not hidden behind vague language.
- Errors explain the probable cause and the next available action.
- Browser, GPU, or model limits are stated as facts, never as something the user did wrong.

## Shape And Layout

The core radii are:

- controls: `8px`
- cards: `16px`
- large panels: `28px`

Spacing follows a 4px base with preferred steps of 8, 12, 16, 24, 32, 48, 64, and 96px. Normal cards should rely on surface color and borders; shadows are reserved for real overlays such as drawers and floating controls.

## Accessibility And Motion

Text and controls should meet accessible contrast targets. Focus states must remain visible with at least a 2px ring. State must not rely on color alone. Important touch targets should be around 44px.

Motion should be short and functional: 150-220ms for micro-interactions and up to 300-450ms for panels. Respect `prefers-reduced-motion`. Do not add decorative infinite animation, video, particles, 3D logos, or canvas effects to the product interface.
