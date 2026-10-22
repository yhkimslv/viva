#!/usr/bin/env node
// Generate the committed native icons from the canonical SVG artwork.
// Keep the rasterizer outside the app's dependencies:
//   npm install --prefix /tmp/viva-brand-tools --no-save --package-lock=false --ignore-scripts @resvg/resvg-js@2.6.2
//   node scripts/branding/generate-icons.mjs --tools-dir /tmp/viva-brand-tools --font-file /System/Library/Fonts/Supplemental/Arial.ttf --font-file '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
// Use the same font files when regenerating a banner containing SVG text.

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const brandDirectory = join(root, 'assets/brand')
const options = new Map()
const fontFiles = []
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!['--tools-dir', '--font-file'].includes(key) || !value || options.has(key)) {
    throw new Error('Usage: node scripts/branding/generate-icons.mjs --tools-dir <directory> [--font-file <font.ttf> ...]')
  }
  if (key === '--font-file') fontFiles.push(resolve(value))
  else options.set(key, value)
}

const toolsDirectory = options.get('--tools-dir') || process.env.VIVA_BRAND_TOOLS
if (!toolsDirectory || !isAbsolute(toolsDirectory)) {
  throw new Error('Provide an absolute --tools-dir containing @resvg/resvg-js@2.6.2.')
}
const requireTool = createRequire(join(toolsDirectory, 'package.json'))
const rasterizerPackage = requireTool('@resvg/resvg-js/package.json')
if (rasterizerPackage.version !== '2.6.2') {
  throw new Error(`Expected @resvg/resvg-js 2.6.2; found ${rasterizerPackage.version}.`)
}
const { Resvg } = requireTool('@resvg/resvg-js')
const iconSource = await readFile(join(brandDirectory, 'viva-icon.svg'), 'utf8')
const bannerSource = await readFile(join(brandDirectory, 'viva-banner.svg'), 'utf8')
if (/<text(?:\s|>)/i.test(bannerSource) && fontFiles.length === 0) {
  throw new Error('The banner contains SVG text. Provide --font-file to keep font rendering reproducible.')
}
for (const fontFile of fontFiles) {
  const font = await readFile(fontFile)
  console.log(`${fontFile} SHA-256: ${createHash('sha256').update(font).digest('hex')}`)
}

function render(source, width, height, fontFiles = []) {
  const rendered = new Resvg(source, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Arial' }
  }).render()
  if (rendered.width !== width || rendered.height !== height) {
    throw new Error(`Expected ${width}x${height}; rendered ${rendered.width}x${rendered.height}.`)
  }
  return Buffer.from(rendered.asPng())
}

const frames = new Map()
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  frames.set(size, render(iconSource, size, size))
}

// ICO directory entries reference standard PNG frames (supported by modern Windows).
function createIco(sizes) {
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16
    const png = frames.get(size)
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  }
  return Buffer.concat([header, ...sizes.map((size) => frames.get(size))])
}

// macOS ICNS stores PNG chunks for regular and Retina representations.
function createIcns() {
  const representations = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]
  ]
  const chunks = representations.map(([type, size]) => {
    const png = frames.get(size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

const banner = render(bannerSource, 1280, 640, fontFiles)
if (banner.length >= 1024 * 1024) {
  throw new Error('The GitHub social preview banner must be smaller than 1 MiB.')
}
const outputs = [
  ['viva-icon.png', frames.get(1024)],
  ['viva-window-icon.png', frames.get(256)],
  ['viva-icon.ico', createIco([16, 24, 32, 48, 64, 128, 256])],
  ['viva-icon.icns', createIcns()],
  ['viva-banner.png', banner]
]
for (const [name, bytes] of outputs) {
  await writeFile(join(brandDirectory, name), bytes)
  console.log(`${name}: ${bytes.length} bytes; SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`)
}
