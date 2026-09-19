// 抓取博客中英两个 Atom feed，按文章 slug 配对后渲染成中英对照列表，写回 README 的标记区。
// 源用 mousebomb.github.io 仓库镜像，避免 GitHub Actions 直连 flashj.cn 的稳定性问题。
import { readFile, writeFile } from 'node:fs/promises'

const CN_FEED = 'https://raw.githubusercontent.com/mousebomb/mousebomb.github.io/master/atom.xml'
const EN_FEED = 'https://raw.githubusercontent.com/mousebomb/mousebomb.github.io/master/en/atom.xml'
const README = new URL('../README.md', import.meta.url)
const MAX_POSTS = 5
const START = '<!-- BLOG-POST-LIST:START -->'
const END = '<!-- BLOG-POST-LIST:END -->'

// 解码 Atom 标题里的 HTML 实体（如 &#39; &amp;）
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// 极简 Atom 解析：只取标题、链接、发布时间三个字段，够本场景使用
function parseAtom(xml) {
  return xml
    .split('<entry>')
    .slice(1)
    .map((block) => {
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
      const link = block.match(/<link href="([^"]+)"/)?.[1] ?? ''
      const published = block.match(/<published>([^<]+)<\/published>/)?.[1] ?? ''
      return { title: decodeEntities(title.trim()), link, published }
    })
    .filter((entry) => entry.link && entry.title)
}

async function fetchAtom(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`抓取 feed 失败：${url} → HTTP ${res.status}`)
  return parseAtom(await res.text())
}

// 用文章路径（slug）作为配对键，中英两版 slug 相同
const slugOf = (link) => new URL(link).pathname
// 英文页地址规则：在中文路径前加 /en（英文 feed 里的 link 未带 /en，故这里自行拼）
const enUrlOf = (link) => `https://flashj.cn/en${new URL(link).pathname}`

function render(items) {
  return items
    .slice(0, MAX_POSTS)
    .map(({ cn, en }) => {
      const date = (cn?.published ?? en.published).slice(0, 10)
      // 中英标题同行渲染，日期置于行末；缺哪一版就只渲染存在的那一版
      if (cn && en) return `- [${cn.title}](${cn.link}) · [${en.title}](${enUrlOf(cn.link)}) - ${date}`
      if (cn) return `- [${cn.title}](${cn.link}) - ${date}`
      return `- [${en.title}](${enUrlOf(en.link)}) - ${date}`
    })
    .join('\n\n')
}

async function main() {
  const [cnEntries, enEntries] = await Promise.all([fetchAtom(CN_FEED), fetchAtom(EN_FEED)])

  const bySlug = new Map()
  for (const entry of enEntries) bySlug.set(slugOf(entry.link), { en: entry })
  for (const entry of cnEntries) {
    const key = slugOf(entry.link)
    bySlug.set(key, { ...bySlug.get(key), cn: entry })
  }

  // 按发布时间倒序，最新在前
  const items = [...bySlug.values()].sort((a, b) =>
    (b.cn?.published ?? b.en.published).localeCompare(a.cn?.published ?? a.en.published)
  )

  const readme = await readFile(README, 'utf8')
  const startIndex = readme.indexOf(START)
  const endIndex = readme.indexOf(END)
  if (startIndex === -1 || endIndex === -1) throw new Error('README 缺少 BLOG-POST-LIST 标记')

  const updated =
    readme.slice(0, startIndex + START.length) +
    '\n' +
    render(items) +
    '\n' +
    readme.slice(endIndex)

  if (updated === readme) {
    console.log('博客列表无变化')
    return
  }
  await writeFile(README, updated)
  console.log(`已更新博客列表，共 ${Math.min(items.length, MAX_POSTS)} 条`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
