import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const collection = JSON.parse(await fs.readFile(path.join(root, 'node_modules/@iconify-json/lucide/icons.json'), 'utf8'))
const names = new Set()
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (/\.(tsx?|css)$/.test(file)) {
      const source = await fs.readFile(file, 'utf8')
      for (const match of source.matchAll(/lucide:([a-z0-9-]+)/g)) names.add(match[1])
    }
  }
}
await collect(path.join(root, 'src'))
const icons = {}, aliases = {}
for (const name of names) {
  if (collection.icons[name]) icons[name] = collection.icons[name]
  else if (collection.aliases?.[name]) {
    aliases[name] = collection.aliases[name]
    const parent = collection.aliases[name].parent
    icons[parent] = collection.icons[parent]
  } else throw new Error(`图标不存在 lucide:${name}`)
}
await fs.writeFile(path.join(root, 'src/icons.json'), JSON.stringify({ prefix: 'lucide', width: collection.width, height: collection.height, icons, aliases }))
