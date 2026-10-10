#!/usr/bin/env node
// Builds the blog from content/blog/*.md into static HTML.
// No dependencies: node scripts/build-blog.mjs
//
// Writes:  blog/index.html, blog/<slug>.html, blog/feed.xml, sitemap.xml

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(ROOT, "content", "blog");
const OUT_DIR = join(ROOT, "blog");
const SITE = "https://ashbirx.me";
const AUTHOR = "Ashish Birajdar";
const OG_IMAGE = `${SITE}/assets/img/og-image.jpg`;
const BLOG_TITLE = "blog";
const BLOG_DESCRIPTION = "Write-ups by ashbirx on things built, things broken, and what they taught me.";
const BANNED = /gate prep|gate|2027/i;

// ---------- helpers ----------

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");

function fail(msg) {
  console.error(`build-blog: ${msg}`);
  process.exit(1);
}

// ---------- front matter ----------

function parseFrontMatter(src, file) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) fail(`${file}: missing front matter block`);
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) fail(`${file}: cannot parse front matter line: ${line}`);
    let value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else {
      value = unquote(value);
    }
    data[kv[1]] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// ---------- markdown (small, safe subset) ----------

function safeUrl(url) {
  const u = url.trim();
  if (/^(https?:|mailto:|\/|#|\.\.?\/)/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return "#";
}

function inline(text) {
  const codes = [];
  // protect code spans first so nothing inside them is formatted
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${esc(safeUrl(src))}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const url = safeUrl(href.replace(/&amp;/g, "&"));
    const external = /^https?:/i.test(url) && !url.startsWith(SITE);
    return `<a href="${esc(url)}"${external ? ' rel="noopener"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const RE = {
  fence: /^```\s*([\w+-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/,
  quote: /^>\s?/,
  ul: /^[-*+]\s+/,
  ol: /^\d+[.)]\s+/,
};

function isBlockStart(line) {
  return RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.ul.test(line) || RE.ol.test(line);
}

function markdown(src, { skipTitle } = {}) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let seenContent = false;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(RE.fence))) {
      const lang = m[1];
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      const cls = lang ? ` class="language-${esc(lang)}"` : "";
      out.push(`<pre tabindex="0"><code${cls}>${esc(code.join("\n"))}</code></pre>`);
      seenContent = true;
      continue;
    }

    if ((m = line.match(RE.heading))) {
      i++;
      const text = m[2];
      if (!seenContent && m[1].length === 1 && skipTitle && text.trim() === skipTitle.trim()) {
        continue; // the page template already renders the title as <h1>
      }
      const level = Math.min(Math.max(m[1].length, 2), 6); // only one h1 per page
      const html = inline(text);
      out.push(`<h${level} id="${slugify(html)}">${html}</h${level}>`);
      seenContent = true;
      continue;
    }

    if (RE.hr.test(line)) { out.push("<hr>"); i++; seenContent = true; continue; }

    if (RE.quote.test(line)) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && RE.quote.test(lines[i])) inner.push(lines[i++].replace(RE.quote, ""));
      out.push(`<blockquote>\n${markdown(inner.join("\n"))}\n</blockquote>`);
      seenContent = true;
      continue;
    }

    if (RE.ul.test(line) || RE.ol.test(line)) {
      const ordered = RE.ol.test(line);
      const marker = ordered ? RE.ol : RE.ul;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (marker.test(l)) { items.push(l.replace(marker, "")); i++; continue; }
        if (l.trim() && /^\s+/.test(l) && items.length) { items[items.length - 1] += " " + l.trim(); i++; continue; }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>\n${items.map((it) => `  <li>${inline(it)}</li>`).join("\n")}\n</${tag}>`);
      seenContent = true;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
    seenContent = true;
  }

  return out.join("\n");
}

// ---------- shared page pieces ----------

function formatDate(iso) {
  return iso; // ISO dates suit the terminal look and read the same everywhere
}

function rfc822(iso) {
  return new Date(`${iso}T00:00:00Z`).toUTCString();
}

function head({ title, description, canonical, type, extraMeta = "", ld }) {
  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="author" content="${esc(AUTHOR)}">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0a0d0b">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="ashbirx blog" href="${SITE}/blog/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap">

  <link rel="icon" type="image/png" href="/assets/icons/favicon-96x96.png" sizes="96x96" />
  <link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/blog.css">

  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="ashbirx">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
${extraMeta}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${OG_IMAGE}">

  <script type="application/ld+json">
${jsonLd(ld)}
  </script>

  <!-- Vercel Web Analytics -->
  <script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>

  <!-- Vercel Speed Insights -->
  <script>
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
  </script>
  <script defer src="/_vercel/speed-insights/script.js"></script>
</head>
`;
}

function prompt(cmd) {
  return `    <header class="prompt">
      <span class="path">ashbirx@jarvis</span><span class="colon">:</span><span class="tilde"><a href="/" aria-label="home">~</a>/<a href="/blog">blog</a>$</span>
      <span class="cmd">${esc(cmd)}</span>
    </header>`;
}

const FOOT = `    <footer class="foot">
      <p class="cursor-line">ashbirx@jarvis:~/blog$ <span class="cursor" aria-hidden="true">_</span></p>
    </footer>`;

function tagList(tags) {
  if (!tags.length) return "";
  return `<ul class="tags" aria-label="tags">${tags.map((t) => `<li>#${esc(t)}</li>`).join("")}</ul>`;
}

function meta(post) {
  const rt = post.reading_time ? ` <span aria-hidden="true">·</span> ${esc(post.reading_time)} read` : "";
  return `<p class="post-meta"><time datetime="${esc(post.date)}">${esc(formatDate(post.date))}</time>${rt}</p>`;
}

// ---------- pages ----------

function postPage(post) {
  const url = `${SITE}/blog/${post.slug}`;
  const extraMeta = [
    `  <meta property="article:published_time" content="${esc(post.date)}">`,
    `  <meta property="article:author" content="${esc(post.author)}">`,
    ...post.tags.map((t) => `  <meta property="article:tag" content="${esc(t)}">`),
  ].join("\n") + "\n";
  const ld = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated || post.date,
    author: { "@type": "Person", name: post.author, url: `${SITE}/` },
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: OG_IMAGE,
    keywords: post.tags.join(", "),
  };

  return `${head({ title: `${post.title} — ashbirx`, description: post.description, canonical: url, type: "article", extraMeta, ld })}
<body>
  <a class="skip" href="#main">skip to content</a>

  <div class="wrap">

${prompt(`cat ${post.slug}.md`)}

    <main id="main">
      <article class="post">
        <header class="post-head">
          <h1>${esc(post.title)}</h1>
          ${meta(post)}
          ${tagList(post.tags)}
        </header>

        <div class="post-body">
${post.html}
        </div>
      </article>
    </main>

    <hr>

    <nav class="links" aria-label="blog">
      <a href="/blog">[cd ..]<span class="sr-only"> all posts</span></a>
      <a href="/">[cd ~]<span class="sr-only"> home</span></a>
    </nav>

    <hr>

${FOOT}

  </div>
</body>

</html>
`;
}

function indexPage(posts) {
  const url = `${SITE}/blog`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "ashbirx blog",
    description: BLOG_DESCRIPTION,
    url,
    author: { "@type": "Person", name: AUTHOR, url: `${SITE}/` },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      datePublished: p.date,
      url: `${SITE}/blog/${p.slug}`,
    })),
  };

  const list = posts.length
    ? `<ol class="post-list" reversed>
${posts
  .map(
    (p) => `        <li>
          <article class="post-item">
            <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
            ${meta(p)}
            <p class="post-desc">${esc(p.description)}</p>
            ${tagList(p.tags)}
          </article>
        </li>`
  )
  .join("\n")}
      </ol>`
    : `<p class="empty">ls: no posts yet. check back soon.</p>`;

  const count = `${posts.length} ${posts.length === 1 ? "post" : "posts"}`;

  return `${head({ title: `${BLOG_TITLE} — ashbirx`, description: BLOG_DESCRIPTION, canonical: url, type: "website", ld })}
<body>
  <a class="skip" href="#main">skip to content</a>

  <div class="wrap">

${prompt("ls -t")}

    <main id="main">
      <header class="blog-head">
        <h1>${BLOG_TITLE}</h1>
        <p class="blog-intro">${esc(BLOG_DESCRIPTION)}</p>
        <p class="post-count">total ${count}</p>
      </header>

      ${list}
    </main>

    <hr>

    <nav class="links" aria-label="site">
      <a href="/">[cd ~]<span class="sr-only"> home</span></a>
      <a href="/blog/feed.xml">[rss]</a>
    </nav>

    <hr>

${FOOT}

  </div>
</body>

</html>
`;
}

function feed(posts) {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE}/blog/${p.slug}</link>
      <guid isPermaLink="true">${SITE}/blog/${p.slug}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${esc(p.description)}</description>
${p.tags.map((t) => `      <category>${esc(t)}</category>`).join("\n")}
    </item>`
    )
    .join("\n");
  const last = posts.length ? rfc822(posts[0].date) : new Date(0).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ashbirx blog</title>
    <link>${SITE}/blog</link>
    <description>${esc(BLOG_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${last}</lastBuildDate>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

function sitemap(posts) {
  const path = join(ROOT, "sitemap.xml");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  // keep every non-blog entry exactly as it is
  const kept = (existing.match(/  <url>[\s\S]*?<\/url>/g) || []).filter((u) => !u.includes(`${SITE}/blog`));
  const entry = (loc, lastmod, freq, priority) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  const blog = posts.length ? [entry(`${SITE}/blog`, posts[0].date, "weekly", "0.8")] : [];
  for (const p of posts) blog.push(entry(`${SITE}/blog/${p.slug}`, p.updated || p.date, "yearly", "0.7"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...kept, ...blog].join("\n")}
</urlset>
`;
}

// ---------- build ----------

const files = existsSync(CONTENT_DIR) ? readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md")).sort() : [];
const posts = [];
const slugs = new Set();

for (const file of files) {
  const src = readFileSync(join(CONTENT_DIR, file), "utf8");
  if (BANNED.test(src)) fail(`${file}: contains a banned string (GATE / 2027 / gate prep)`);
  const { data, body } = parseFrontMatter(src, file);
  for (const key of ["title", "slug", "date", "description"]) {
    if (!data[key]) fail(`${file}: front matter is missing "${key}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) fail(`${file}: date must be YYYY-MM-DD`);
  if (!/^[a-z0-9-]+$/.test(data.slug)) fail(`${file}: slug must be lowercase letters, digits and dashes`);
  if (slugs.has(data.slug)) fail(`${file}: duplicate slug "${data.slug}"`);
  if (data.draft === "true") continue;
  slugs.add(data.slug);
  posts.push({
    ...data,
    author: data.author || AUTHOR,
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
    html: markdown(body, { skipTitle: data.title }),
  });
}

posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));

mkdirSync(OUT_DIR, { recursive: true });

// remove pages for posts that no longer exist
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".html") && f !== "index.html" && !slugs.has(f.slice(0, -5))) unlinkSync(join(OUT_DIR, f));
}

const outputs = new Map();
for (const p of posts) outputs.set(join(OUT_DIR, `${p.slug}.html`), postPage(p));
outputs.set(join(OUT_DIR, "index.html"), indexPage(posts));
outputs.set(join(OUT_DIR, "feed.xml"), feed(posts));
outputs.set(join(ROOT, "sitemap.xml"), sitemap(posts));

for (const [path, content] of outputs) {
  const rel = path.slice(ROOT.length + 1);
  if (BANNED.test(content)) fail(`${rel}: generated output contains a banned string`);
  writeFileSync(path, content);
  console.log(`wrote ${rel}`);
}

console.log(`built ${posts.length} ${posts.length === 1 ? "post" : "posts"}`);
