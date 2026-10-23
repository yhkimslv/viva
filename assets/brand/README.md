# VIVA brand assets

The white V connects three Git history nodes. Blue follows the desktop app's accent color; the cyan node highlights the shared result. Keep the mark consistent across the app, installers, and repository.

## Sources and exports

- `viva-icon.svg`: editable 1024 × 1024 mark, with transparent padding for desktop icon sizing.
- `viva-banner.svg`: editable 1280 × 640 repository and release banner.
- `viva-icon.png`: 1024px PNG for previews and Linux packaging.
- `viva-window-icon.png`: 256px PNG used by native windows.
- `viva-icon.icns`: macOS app bundle and Dock icon, including Retina sizes.
- `viva-icon.ico`: Windows application and installer icon, including small sizes.
- `viva-banner.png`: GitHub README, release, and social preview image, below 1 MiB.

The renderer imports the SVG with `?no-inline` so it remains a local asset under the app's content security policy. Packaging uses the committed native icons; end users do not need the generation tools.

## Regenerate exports

From the repository root on macOS:

```sh
npm install --prefix /tmp/viva-brand-tools --no-save --package-lock=false --ignore-scripts @resvg/resvg-js@2.6.2
node scripts/branding/generate-icons.mjs --tools-dir /tmp/viva-brand-tools --font-file /System/Library/Fonts/Supplemental/Arial.ttf --font-file '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
```

This keeps the rasterizer outside the app's dependencies. The generator pins its version, takes explicit font files, and prints font and output hashes. Use the same fonts for matching banner exports. Check the PNGs visually after changing either SVG, then rebuild the installers to update native app icons.

For GitHub link previews, upload `viva-banner.png` under repository **Settings → General → Social preview**. The README uses a relative image path; a release description uses an absolute URL pinned to its release tag.
