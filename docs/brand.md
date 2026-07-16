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

## Typography

Use:

- Sans: `Inter, ui-sans-serif, system-ui, sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Consolas, monospace`

No runtime third-party font CDN is used. If Inter is unavailable, the browser falls back to system fonts.

## Shape And Layout

The core radii are:

- controls: `8px`
- cards: `16px`
- large panels: `28px`

Spacing follows a 4px base with preferred steps of 8, 12, 16, 24, 32, 48, 64, and 96px. Normal cards should rely on surface color and borders; shadows are reserved for real overlays such as drawers and floating controls.

## Accessibility And Motion

Text and controls should meet accessible contrast targets. Focus states must remain visible with at least a 2px ring. State must not rely on color alone. Important touch targets should be around 44px.

Motion should be short and functional: 150-220ms for micro-interactions and up to 300-450ms for panels. Respect `prefers-reduced-motion`. Do not add decorative infinite animation, video, particles, 3D logos, or canvas effects to the product interface.
