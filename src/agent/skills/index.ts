import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface SkillMeta {
  name: string;
  description: string;
  /** Absolute path to SKILL.md */
  filePath: string;
}

interface ParsedSkill {
  meta: SkillMeta;
  body: string;
  /** Heading title → full section text (including the heading line). */
  sections: Map<string, string>;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    // Support YAML folded/literal scalars: description: >-  / |  then indented lines.
    if (value === ">" || value === ">-" || value === "|" || value === "|-") {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i++;
        parts.push(lines[i].trim());
      }
      value = parts.join(value.startsWith("|") ? "\n" : " ").trim();
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    meta[key] = value;
  }
  return { meta, body: match[2] };
}

function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let currentTitle = "";
  let current: string[] = [];
  const flush = () => {
    if (!currentTitle) return;
    sections.set(currentTitle.toLowerCase(), current.join("\n").trim());
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      current = [line];
    } else if (currentTitle) {
      current.push(line);
    }
  }
  flush();
  return sections;
}

function loadAll(): ParsedSkill[] {
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: ParsedSkill[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const filePath = path.join(SKILLS_DIR, ent.name, "SKILL.md");
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const name = meta.name || ent.name;
    skills.push({
      meta: {
        name,
        description: meta.description || `Skill: ${name}`,
        filePath,
      },
      body: body.trim(),
      sections: splitSections(body),
    });
  }
  return skills.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

let cache: ParsedSkill[] | null = null;

function skills(): ParsedSkill[] {
  if (!cache) cache = loadAll();
  return cache;
}

/** List installed skills (name + description). */
export function listSkills(): SkillMeta[] {
  return skills().map((s) => s.meta);
}

/**
 * Load a skill by name. With `topic`, return matching ## sections (by heading or keywords line).
 * Without topic, return a short index (all ## headings) plus the How-to section if present.
 */
export function readSkill(name: string, topic?: string): string {
  const skill = skills().find((s) => s.meta.name.toLowerCase() === name.toLowerCase());
  if (!skill) {
    const available = listSkills()
      .map((s) => s.name)
      .join(", ");
    throw new Error(`Unknown skill "${name}". Available: ${available || "(none)"}.`);
  }

  if (!topic?.trim()) {
    const headings = [...skill.sections.keys()];
    const howto =
      skill.sections.get("how to use this skill") ??
      skill.sections.get("how to use") ??
      "";
    const index = headings.map((h) => `- ${h}`).join("\n");
    return [
      `# ${skill.meta.name}`,
      skill.meta.description,
      "",
      howto,
      "",
      "## Topics in this skill",
      "Call load_skill again with `topic` set to one of these (or a keyword like mute, ban, channel):",
      index,
    ]
      .filter((l) => l !== undefined)
      .join("\n")
      .trim();
  }

  const q = topic.toLowerCase().trim();
  const matched: string[] = [];
  for (const [title, text] of skill.sections) {
    if (title.includes(q) || (/\*\*keywords:\*\*/i.test(text) && sectionMatches(text, q))) {
      matched.push(text);
      continue;
    }
    if (title.split(/[^a-z0-9]+/).some((w) => w === q || w.startsWith(q))) {
      matched.push(text);
    }
  }

  // Broader fallback: any section whose body mentions the topic as a whole word near keywords/tool lines.
  if (matched.length === 0) {
    for (const [, text] of skill.sections) {
      if (new RegExp(`\\b${escapeRe(q)}\\b`, "i").test(text)) matched.push(text);
    }
  }

  if (matched.length === 0) {
    const headings = [...skill.sections.keys()].join(", ");
    return `No section in "${skill.meta.name}" matched topic "${topic}". Topics: ${headings}`;
  }

  return matched.join("\n\n---\n\n").slice(0, 12_000);
}

function sectionMatches(text: string, q: string): boolean {
  const kwLine = text.match(/\*\*keywords:\*\*\s*(.+)/i);
  if (!kwLine) return false;
  const keywords = kwLine[1]
    .toLowerCase()
    .split(/[,/]/)
    .flatMap((s) => s.split(/\band\b/))
    .map((s) => s.trim())
    .filter(Boolean);
  return keywords.some((k) => k === q || k.includes(q) || q.includes(k));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
