const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid journal date: ${dateString}`);
  }

  return date;
}

function getWeekStart(dateString) {
  const date = parseLocalDate(dateString);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function parseFrontmatter(rawContent) {
  const normalized = rawContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    return {
      frontmatter: {},
      content: normalized
    };
  }

  const frontmatter = {};
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "---") {
      index += 1;
      break;
    }

    const separator = line.indexOf(":");

    if (separator !== -1) {
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      }

      frontmatter[key] = value;
    }

    index += 1;
  }

  return {
    frontmatter,
    content: lines.slice(index).join("\n")
  };
}

function stringifyFrontmatterValue(value) {
  return JSON.stringify(String(value));
}

function serializeEntry(entry) {
  const frontmatterLines = [
    "---",
    `title: ${stringifyFrontmatterValue(entry.title || "")}`,
    `date: ${stringifyFrontmatterValue(entry.date)}`,
    `createdAt: ${stringifyFrontmatterValue(entry.createdAt)}`,
    `updatedAt: ${stringifyFrontmatterValue(entry.updatedAt)}`,
    "---",
    ""
  ];

  const content = entry.content || "";
  return `${frontmatterLines.join("\n")}${content.endsWith("\n") ? content : `${content}\n`}`;
}

function sanitizeEntry(entryLike) {
  const now = new Date().toISOString();

  return {
    title: typeof entryLike.title === "string" ? entryLike.title : "",
    date: typeof entryLike.date === "string" && entryLike.date ? entryLike.date : formatDate(new Date()),
    content: typeof entryLike.content === "string" ? entryLike.content : "",
    slug: typeof entryLike.slug === "string" && entryLike.slug ? entryLike.slug : "",
    createdAt: typeof entryLike.createdAt === "string" && entryLike.createdAt ? entryLike.createdAt : now,
    updatedAt: typeof entryLike.updatedAt === "string" && entryLike.updatedAt ? entryLike.updatedAt : now
  };
}

function buildEntryPath(rootDirectory, entry) {
  const weekStart = getWeekStart(entry.date);
  const yearFolder = String(weekStart.getFullYear());
  const monthIndex = String(weekStart.getMonth() + 1).padStart(2, "0");
  const monthName = weekStart.toLocaleString("en-US", { month: "long" });
  const monthFolder = `${monthIndex}-${monthName}`;
  const weekFolder = `week-of-${formatDate(weekStart)}`;
  const fileName = `${entry.date}-${entry.slug}.md`;

  return path.join(rootDirectory, yearFolder, monthFolder, weekFolder, fileName);
}

function createSlug() {
  return crypto.randomBytes(4).toString("hex");
}

async function ensureUniqueSlug(rootDirectory, dateString, requestedSlug = "") {
  let slug = requestedSlug || createSlug();

  while (true) {
    const targetPath = buildEntryPath(rootDirectory, { date: dateString, slug });

    try {
      await fsp.access(targetPath, fs.constants.F_OK);
      slug = createSlug();
    } catch {
      return slug;
    }
  }
}

async function ensureAvailableSlug(rootDirectory, dateString, sourcePath, requestedSlug = "") {
  let slug = requestedSlug || createSlug();

  while (true) {
    const candidatePath = buildEntryPath(rootDirectory, { date: dateString, slug });

    try {
      await fsp.access(candidatePath, fs.constants.F_OK);

      if (sourcePath && path.resolve(candidatePath) === path.resolve(sourcePath)) {
        return slug;
      }

      slug = createSlug();
    } catch {
      return slug;
    }
  }
}

function ensureInsideRoot(rootDirectory, candidatePath) {
  const root = path.resolve(rootDirectory);
  const candidate = path.resolve(candidatePath);

  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    return candidate;
  }

  throw new Error("Attempted to access a file outside the selected journal directory.");
}

async function walkMarkdownFiles(directory) {
  let entries = [];
  const children = await fsp.readdir(directory, { withFileTypes: true });

  for (const child of children) {
    if (child.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, child.name);

    if (child.isDirectory()) {
      entries = entries.concat(await walkMarkdownFiles(absolutePath));
      continue;
    }

    if (child.isFile() && absolutePath.endsWith(".md")) {
      entries.push(absolutePath);
    }
  }

  return entries;
}

function getSlugFromFilename(filePath) {
  const name = path.basename(filePath, ".md");
  const match = name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : "";
}

function summarizeContent(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
}

async function readEntryFile(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  const { frontmatter, content } = parseFrontmatter(raw);
  const stats = await fsp.stat(filePath);
  const fallbackDate = path.basename(filePath).slice(0, 10);

  return {
    filePath,
    slug: getSlugFromFilename(filePath),
    title: frontmatter.title || "",
    date: frontmatter.date || fallbackDate || formatDate(stats.mtime),
    createdAt: frontmatter.createdAt || stats.birthtime.toISOString(),
    updatedAt: frontmatter.updatedAt || stats.mtime.toISOString(),
    content,
    preview: summarizeContent(content)
  };
}

async function listEntries(rootDirectory) {
  const markdownFiles = await walkMarkdownFiles(rootDirectory);
  const entries = await Promise.all(markdownFiles.map((filePath) => readEntryFile(filePath)));

  return entries
    .sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((entry) => ({
      filePath: entry.filePath,
      slug: entry.slug,
      title: entry.title,
      date: entry.date,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      preview: entry.preview
    }));
}

async function pruneEmptyDirectories(startDirectory, stopDirectory) {
  let currentDirectory = path.resolve(startDirectory);
  const stop = path.resolve(stopDirectory);

  while (currentDirectory.startsWith(stop) && currentDirectory !== stop) {
    const children = await fsp.readdir(currentDirectory);

    if (children.length > 0) {
      return;
    }

    await fsp.rmdir(currentDirectory);
    currentDirectory = path.dirname(currentDirectory);
  }
}

async function saveEntry(rootDirectory, incomingEntry) {
  const entry = sanitizeEntry(incomingEntry);
  const sourcePath = incomingEntry.filePath ? ensureInsideRoot(rootDirectory, incomingEntry.filePath) : "";
  const slug = sourcePath
    ? await ensureAvailableSlug(rootDirectory, entry.date, sourcePath, entry.slug || getSlugFromFilename(sourcePath))
    : await ensureUniqueSlug(rootDirectory, entry.date, entry.slug);
  const now = new Date().toISOString();

  entry.slug = slug;
  entry.updatedAt = now;
  entry.createdAt = sourcePath ? entry.createdAt : now;

  const targetPath = ensureInsideRoot(rootDirectory, buildEntryPath(rootDirectory, entry));
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.tmp`);
  await fsp.writeFile(tempPath, serializeEntry(entry), "utf8");
  await fsp.rename(tempPath, targetPath);

  if (sourcePath && sourcePath !== targetPath) {
    await fsp.rm(sourcePath, { force: true });
    await pruneEmptyDirectories(path.dirname(sourcePath), rootDirectory);
  }

  return readEntryFile(targetPath);
}

module.exports = {
  ensureInsideRoot,
  formatDate,
  listEntries,
  readEntryFile,
  saveEntry
};
