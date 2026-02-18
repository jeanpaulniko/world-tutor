/**
 * Intelligence Engine — Single-file server.
 * Runs on Bun, connects to PostgreSQL, serves at port 9877.
 * Proxied by Caddy at /engine/*
 *
 * Architecture: noun-relation graph in PostgreSQL.
 * Everything connects to everything. Views determine shape.
 * The engine reads, reasons, writes back.
 */

import pg from "pg";

// ============================================================
// DATABASE LAYER
// ============================================================

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 5432,
  database: "world_tutor",
  user: "musclemap",
  password: "musclemap",
  max: 5,
});

async function sql(text: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

// ============================================================
// METRICS
// ============================================================

const metrics = {
  queries: 0,
  nouns_created: 0,
  relations_created: 0,
  demons_fired: 0,
  total_time_ms: 0,
  start_time: Date.now(),
};

// ============================================================
// GRAPH OPERATIONS
// ============================================================

async function findNoun(label: string) {
  // Exact match first
  const exact = await sql(
    "SELECT * FROM nouns WHERE LOWER(label) = LOWER($1) LIMIT 1",
    [label]
  );
  if (exact.length > 0) return exact[0];

  // Fuzzy via pg_trgm
  const fuzzy = await sql(
    "SELECT *, similarity(LOWER(label), LOWER($1)) AS sim FROM nouns WHERE similarity(LOWER(label), LOWER($1)) > 0.3 ORDER BY sim DESC LIMIT 1",
    [label]
  );
  return fuzzy.length > 0 ? fuzzy[0] : null;
}

async function upsertNoun(
  label: string,
  type: string = "concept",
  properties: any = {}
) {
  const cleanLabel = label.toLowerCase().trim();
  if (STOP_WORDS.has(cleanLabel) || cleanLabel.length <= 1) return null;
  const result = await sql(
    "INSERT INTO nouns (label, type, properties) VALUES ($1, $2, $3) ON CONFLICT (label, type) DO UPDATE SET updated_at = NOW() RETURNING *",
    [cleanLabel, type, JSON.stringify(properties)]
  );
  if (result.length > 0) {
    metrics.nouns_created++;
    // Auto-assign to dimensions in the RTSG phase space
    try { await assignDimensions(result[0].id, type); } catch (_) {}
  }
  return result[0];
}

async function upsertRelation(
  fromId: number,
  toId: number,
  type: string,
  weight: number = 1.0,
  source: string = "engine"
) {
  const result = await sql(
    "INSERT INTO relations (from_id, to_id, type, weight, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (from_id, to_id, type) DO UPDATE SET weight = GREATEST(relations.weight, EXCLUDED.weight), source = EXCLUDED.source RETURNING *",
    [fromId, toId, type, weight, source]
  );
  if (result.length > 0) metrics.relations_created++;
  return result[0];
}

async function getNeighbors(nounId: number) {
  return sql(
    "SELECT r.type AS relation_type, r.weight, CASE WHEN r.from_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction, n.id, n.label, n.type AS noun_type, n.link_count FROM relations r JOIN nouns n ON (CASE WHEN r.from_id = $1 THEN r.to_id ELSE r.from_id END = n.id) WHERE r.from_id = $1 OR r.to_id = $1 ORDER BY r.weight DESC",
    [nounId]
  );
}

async function findPath(
  fromLabel: string,
  toLabel: string,
  maxDepth: number = 4
) {
  const from = await findNoun(fromLabel);
  const to = await findNoun(toLabel);
  if (!from || !to) return null;

  const visited = new Set<number>();
  const queue: { id: number; path: any[] }[] = [
    { id: from.id, path: [{ label: from.label, type: from.type }] },
  ];
  visited.add(from.id);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;

    const neighbors = await getNeighbors(current.id);
    for (const n of neighbors) {
      if (n.id === to.id) {
        return [
          ...current.path,
          { label: n.label, type: n.noun_type, via: n.relation_type },
        ];
      }
      if (!visited.has(n.id)) {
        visited.add(n.id);
        queue.push({
          id: n.id,
          path: [
            ...current.path,
            { label: n.label, type: n.noun_type, via: n.relation_type },
          ],
        });
      }
    }
  }
  return null;
}

// ============================================================
// NLP HELPERS
// ============================================================

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "and",
  "but",
  "or",
  "not",
  "no",
  "nor",
  "so",
  "yet",
  "both",
  "either",
  "neither",
  "each",
  "every",
  "all",
  "any",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "then",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "me",
  "my",
  "we",
  "us",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "about",
  "dont",
  "understand",
  "explain",
  "tell",
  "know",
  "think",
  "like",
  "please",
  "help",
  "need",
  "want",
  "get",
  "make",
  "go",
  "see",
  "come",
  "take",
  "give",
  "say",
  "said",
  "contains",
  "causes",
  "requires",
  "produces",
  "depends",
  "leads",
  "made",
  "part",
  "much",
  "many",
  "really",
  "still",
  "well",
  "only",
  "even",
  "because",
  "since",
  "while",
  "though",
  "although",
  "until",
  "unless",
  "whether",
  "if",
  "up",
  "down",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "once",
  "same",
  "own",
  "does",
  "doing",
  "having",
  "being",
]);

function extractNouns(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

function detectIntent(text: string): string {
  const lower = text.toLowerCase().trim();
  if (lower.match(/^(hi|hello|hey|greetings|good\s|yo\b|sup\b)/))
    return "greeting";
  if (
    lower.match(
      /\?|^(what|why|how|when|where|who|which|can|does|is there|do you)/
    )
  )
    return "question";
  if (lower.match(/i\s+(don'?t|dont|do not)\s+(understand|get|know)/))
    return "confusion";
  if (lower.match(/^(i think|i believe|actually|no,?\s|but\s)/))
    return "claim";
  return "statement";
}

// ============================================================
// REASONING PIPELINE
// ============================================================

interface ReasonResult {
  response: string;
  nouns_found: string[];
  nouns_unknown: string[];
  relations_found: any[];
  intent: string;
  demons_fired: string[];
  duration_ms: number;
}

async function reason(text: string): Promise<ReasonResult> {
  const start = Date.now();
  const demons_fired: string[] = [];
  const intent = detectIntent(text);
  const nouns = extractNouns(text);
  demons_fired.push("parse");

  // ── RELATE: Look up each noun in the graph ──
  const found: any[] = [];
  const unknown: string[] = [];
  for (const label of nouns) {
    const noun = await findNoun(label);
    if (noun) {
      found.push(noun);
      try { await trackUsage(noun.id); } catch (_) {}
    } else {
      unknown.push(label);
    }
  }
  demons_fired.push("relate");

  // ── INFER: Get relations for found nouns ──
  const relations: any[] = [];
  for (const noun of found) {
    const neighbors = await getNeighbors(noun.id);
    relations.push(
      ...neighbors.map((n: any) => ({
        from: n.direction === "outgoing" ? noun.label : n.label,
        relation: n.relation_type,
        to: n.direction === "outgoing" ? n.label : noun.label,
        weight: n.weight,
        direction: n.direction,
      }))
    );
  }
  demons_fired.push("infer");

  // ── QUESTION: Build Socratic response ──
  let response = "";

  if (intent === "greeting") {
    response =
      "Hello! I'm the Intelligence Engine. I run on pure graph reasoning — no LLM, no API costs. Ask me anything and I'll help you think through it.";
    demons_fired.push("question");
  } else if (found.length === 0 && unknown.length > 0) {
    // Know nothing — explore together
    const unknownStr = unknown.slice(0, 3).join('", "');
    response =
      'Interesting \u2014 let\'s explore "' +
      unknownStr +
      '" together. What do you already know about ' +
      (unknown.length === 1 ? "it" : "them") +
      "?";
    demons_fired.push("question");
  } else if (relations.length > 0) {
    // We have knowledge — build a Socratic response
    demons_fired.push("decompose");

    // Find the most connected noun as the focus
    const mainNoun = found.sort(
      (a: any, b: any) => b.link_count - a.link_count
    )[0];
    const mainRelations = relations.filter(
      (r: any) => r.from === mainNoun.label || r.to === mainNoun.label
    );

    if (intent === "question") {
      // Build guiding question from what we know
      const relDescriptions = mainRelations
        .slice(0, 3)
        .map((r: any) => {
          if (r.direction === "outgoing")
            return mainNoun.label + " " + r.relation.replace(/_/g, " ") + " " + r.to;
          return r.from + " " + r.relation.replace(/_/g, " ") + " " + mainNoun.label;
        });

      response =
        "Good question about " +
        mainNoun.label +
        "! Here's what I know: " +
        relDescriptions.join(", ") +
        ".\n\nBut here's what I want you to think about: ";

      // Target the most interesting gap
      const causes = mainRelations.find(
        (r: any) => r.relation === "causes"
      );
      const requires = mainRelations.find(
        (r: any) => r.relation === "requires"
      );
      const isA = mainRelations.find(
        (r: any) => r.relation === "is_a"
      );

      if (causes) {
        response +=
          "why does " +
          mainNoun.label +
          " cause " +
          causes.to +
          "? What mechanism do you think is at work?";
      } else if (requires) {
        response +=
          "what would happen if " +
          requires.to +
          " were removed? Could " +
          mainNoun.label +
          " still work?";
      } else if (isA) {
        response +=
          "what makes " +
          mainNoun.label +
          " different from other types of " +
          isA.to +
          "?";
      } else {
        response +=
          "what connections do you see between " +
          mainNoun.label +
          " and your everyday experience?";
      }
    } else if (intent === "confusion") {
      demons_fired.push("analogize");
      const parts = mainRelations.filter((r: any) =>
        ["contains", "part_of", "composed_of", "has"].includes(r.relation)
      );
      const requires = mainRelations.filter(
        (r: any) => r.relation === "requires"
      );
      const produces = mainRelations.filter(
        (r: any) => r.relation === "produces"
      );

      response =
        "No worries \u2014 let's break down " +
        mainNoun.label +
        " step by step.\n\n";

      if (requires.length > 0) {
        response +=
          "First, " +
          mainNoun.label +
          " needs: " +
          requires.map((r: any) => r.to).join(", ") +
          ".\n";
      }
      if (produces.length > 0) {
        response +=
          "It produces: " +
          produces.map((r: any) => r.to).join(", ") +
          ".\n";
      }
      if (parts.length > 0) {
        response +=
          "It's made up of: " +
          parts
            .map((r: any) => (r.direction === "outgoing" ? r.to : r.from))
            .join(", ") +
          ".\n";
      }

      response += "\nWhich part is most confusing to you?";
    } else {
      // Statement or claim
      response =
        "I see \u2014 you're connecting " +
        found.map((n: any) => n.label).join(" and ") +
        ". The graph shows " +
        relations.length +
        " relationships here. What's your reasoning?";
      demons_fired.push("question");
    }
  } else if (found.length > 0) {
    // Found nouns but no relations
    response =
      "I know about " +
      found.map((n: any) => n.label).join(", ") +
      ", but I haven't mapped the connections yet. How do you think they relate to each other?";
    demons_fired.push("question");
  } else {
    response =
      "I'd love to help you learn! What topic or question would you like to explore?";
    demons_fired.push("question");
  }

  // ── LEARN: Store unknowns and extract relations ──
  for (const label of unknown) {
    await upsertNoun(label);
  }

  // Extract relations from natural language patterns
  const patterns = [
    { regex: /(\w+)\s+is\s+(?:a|an)\s+(\w+)/gi, type: "is_a" },
    { regex: /(\w+)\s+causes?\s+(\w+)/gi, type: "causes" },
    { regex: /(\w+)\s+requires?\s+(\w+)/gi, type: "requires" },
    { regex: /(\w+)\s+produces?\s+(\w+)/gi, type: "produces" },
    { regex: /(\w+)\s+contains?\s+(\w+)/gi, type: "contains" },
    { regex: /(\w+)\s+(?:is\s+)?part\s+of\s+(\w+)/gi, type: "part_of" },
    { regex: /(\w+)\s+depends?\s+on\s+(\w+)/gi, type: "depends_on" },
    { regex: /(\w+)\s+leads?\s+to\s+(\w+)/gi, type: "leads_to" },
    { regex: /(\w+)\s+(?:is\s+)?made\s+of\s+(\w+)/gi, type: "composed_of" },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const subj = match[1];
      const obj = match[2];
      if (subj && obj && subj.length > 1 && obj.length > 1) {
        const fromNoun = await upsertNoun(subj);
        const toNoun = await upsertNoun(obj);
        if (fromNoun && toNoun) {
          await upsertRelation(
            fromNoun.id,
            toNoun.id,
            pattern.type,
            0.7,
            "learned"
          );
        }
      }
    }
  }
  demons_fired.push("learn");

  metrics.queries++;
  metrics.demons_fired += demons_fired.length;
  const duration_ms = Date.now() - start;
  metrics.total_time_ms += duration_ms;

  // Build ideagram for the response
  const ideagram_relations = relations.slice(0, 5).map((r: any) => {
    const fromGlyph = getGlyph(r.from, "concept");
    const toGlyph = getGlyph(r.to, "concept");
    const sym = getRelSymbol(r.relation);
    return `${fromGlyph} ${sym} ${toGlyph}`;
  });

  return {
    response,
    ideagram: ideagram_relations.length > 0 ? ideagram_relations.join("  ") : null,
    nouns_found: found.map((n: any) => n.label),
    nouns_unknown: unknown,
    relations_found: relations,
    intent,
    demons_fired,
    duration_ms,
  };
}

// ============================================================
// IDEAGRAM VISUAL LANGUAGE
// ============================================================

/** Default glyphs by noun type */
const TYPE_GLYPHS: Record<string, string> = {
  force: "\u26A1",       // ⚡
  entity: "\uD83D\uDD35", // 🔵
  process: "\u2699\uFE0F", // ⚙️
  substance: "\uD83D\uDCA7", // 💧
  structure: "\uD83D\uDD37", // 🔷
  property: "\uD83D\uDCCF", // 📏
  particle: "\u269B\uFE0F", // ⚛️
  concept: "\uD83D\uDCA1", // 💡
  discipline: "\uD83D\uDCD0", // 📐
  phenomenon: "\uD83C\uDF00", // 🌀
  unknown: "\u2753",     // ❓
};

/** Specific noun glyphs (override defaults) */
const NOUN_GLYPHS: Record<string, string> = {
  gravity: "\u2B07\uFE0F",     // ⬇️
  photosynthesis: "\uD83C\uDF3F", // 🌿
  earth: "\uD83C\uDF0D",       // 🌍
  moon: "\uD83C\uDF19",        // 🌙
  sun: "\u2600\uFE0F",         // ☀️
  sunlight: "\u2600\uFE0F",    // ☀️
  water: "\uD83D\uDCA7",       // 💧
  oxygen: "\uD83E\uDE78",      // 🩸 (O₂)
  carbon_dioxide: "\u2601\uFE0F", // ☁️
  plant: "\uD83C\uDF31",       // 🌱
  cell: "\uD83E\uDDE0",        // 🧫→🧠
  nucleus: "\u2B55",           // ⭕
  dna: "\uD83E\uDDEC",         // 🧬
  atom: "\u269B\uFE0F",        // ⚛️
  electron: "\u26AA",          // ⚪
  proton: "\uD83D\uDD34",      // 🔴
  energy: "\u26A1",            // ⚡
  force: "\uD83D\uDCAA",       // 💪
  mass: "\u2B1B",              // ⬛
  acceleration: "\uD83C\uDFCE\uFE0F", // 🏎️
  tides: "\uD83C\uDF0A",       // 🌊
  glucose: "\uD83C\uDF6F",     // 🍯
  mathematics: "\uD83D\uDCD0", // 📐
  molecule: "\uD83D\uDD37",    // 🔷
  hydrogen: "\uD83D\uDFE2",    // 🟢
};

/** Relation type → math symbol */
const RELATION_SYMBOLS: Record<string, string> = {
  causes: "\u2192",      // →
  requires: "\u2190",     // ←
  is_a: "\u2208",        // ∈
  contains: "\u2283",     // ⊃
  part_of: "\u2282",      // ⊂
  produces: "\u27F9",     // ⟹
  composed_of: "\u2261",  // ≡
  relates_to: "\u223C",   // ∼
  depends_on: "\u2190",   // ←
  leads_to: "\u2192",     // →
  has: "\u2283",          // ⊃
  performs: "\u25B6",      // ▶
  converts: "\u21C4",     // ⇄
  describes: "\u2248",    // ≈
};

function getGlyph(label: string, type: string, properties?: any): string {
  if (properties?.glyph) return properties.glyph;
  return NOUN_GLYPHS[label] || NOUN_GLYPHS[label.replace(/\s+/g, "_")] || TYPE_GLYPHS[type] || TYPE_GLYPHS.unknown;
}

function getRelSymbol(relType: string): string {
  return RELATION_SYMBOLS[relType] || "\u223C"; // default: ∼
}

async function buildIdeagram(noun: any) {
  const glyph = getGlyph(noun.label, noun.type);
  const neighbors = await getNeighbors(noun.id);

  const visualRelations = neighbors.map((n: any) => {
    const nGlyph = getGlyph(n.label, n.noun_type);
    const symbol = getRelSymbol(n.relation_type);
    const isOut = n.direction === "outgoing";
    return {
      symbol: isOut ? `${glyph} ${symbol} ${nGlyph}` : `${nGlyph} ${symbol} ${glyph}`,
      text: isOut
        ? `${noun.label} ${n.relation_type.replace(/_/g, " ")} ${n.label}`
        : `${n.label} ${n.relation_type.replace(/_/g, " ")} ${noun.label}`,
      glyph: nGlyph,
      relation: n.relation_type,
      direction: n.direction,
      neighbor: n.label,
    };
  });

  // Build formula: glyph + its top relations
  const formulaParts = neighbors.slice(0, 4).map((n: any) => {
    const nGlyph = getGlyph(n.label, n.noun_type);
    const sym = getRelSymbol(n.relation_type);
    return n.direction === "outgoing" ? `${sym} ${nGlyph}` : `${nGlyph} ${sym}`;
  });
  const formula = formulaParts.length > 0
    ? `${glyph} ${formulaParts.join(" ")}`
    : glyph;

  return {
    noun: noun.label,
    type: noun.type,
    glyph,
    formula,
    relations: visualRelations,
    link_count: noun.link_count,
  };
}

async function buildFormulaPath(fromLabel: string, toLabel: string) {
  const pathResult = await findPath(fromLabel, toLabel);
  if (!pathResult) return null;

  const glyphChain = pathResult.map((step: any, i: number) => {
    const g = getGlyph(step.label, step.type);
    if (i === 0) return g;
    const sym = getRelSymbol(step.via || "relates_to");
    return `${sym} ${g}`;
  });

  const labelChain = pathResult.map((step: any, i: number) => {
    if (i === 0) return step.label;
    return `\u2192 ${step.label}`;
  });

  return {
    from: fromLabel,
    to: toLabel,
    glyph_formula: glyphChain.join(" "),
    text_formula: labelChain.join(" "),
    steps: pathResult.length,
    path: pathResult.map((step: any) => ({
      label: step.label,
      type: step.type,
      glyph: getGlyph(step.label, step.type),
      via: step.via,
    })),
  };
}

// ============================================================
// RTSG — RELATIONAL THREE-SPACE GEOMETRY
// 21st century math: concept spheres, Grothendieck topologies,
// sheaf sections, nerve complexes, intelligence metrics.
// Agent zero is IN the system. Truth is local.
// ============================================================

/** The 8 dimensions of intelligence */
const DIMENSIONS: Record<number, { name: string; glyph: string }> = {
  1: { name: "Spatial", glyph: "🗺️" },
  2: { name: "Linguistic", glyph: "📝" },
  3: { name: "Logical-Mathematical", glyph: "🔢" },
  4: { name: "Bodily-Kinesthetic", glyph: "🏃" },
  5: { name: "Musical", glyph: "🎵" },
  6: { name: "Interpersonal", glyph: "🤝" },
  7: { name: "Intrapersonal", glyph: "🧘" },
  8: { name: "Naturalistic", glyph: "🌿" },
};

/** Priority tuple — the linked list of what matters most.
 *  Index 0 = highest priority. Agent zero (the user) IS the system.
 *  This ordering defines the Grothendieck topology of value. */
const PRIORITY_TUPLE = [
  { rank: 0, label: "agent_zero", glyph: "👁️", description: "The observer. The hypervisor. You." },
  { rank: 1, label: "utility", glyph: "⚡", description: "Maximum utility for the world" },
  { rank: 2, label: "intelligence", glyph: "🧠", description: "Measurable cognitive density" },
  { rank: 3, label: "novelty", glyph: "✨", description: "Fresh, novel, unprecedented connections" },
  { rank: 4, label: "connectivity", glyph: "🕸️", description: "Dense relational networks" },
  { rank: 5, label: "coherence", glyph: "💎", description: "Global consistency (H¹ = 0)" },
  { rank: 6, label: "dimensional_span", glyph: "🌈", description: "Coverage across all 8 dimensions" },
  { rank: 7, label: "freshness", glyph: "🔥", description: "Recently active, recently used" },
  { rank: 8, label: "compound_depth", glyph: "🏔️", description: "Built from primes, multi-layered" },
];

/** Auto-assign dimensions based on noun type */
const TYPE_DIMENSIONS: Record<string, { dim: number; radius: number; density: number }[]> = {
  force:       [{ dim: 3, radius: 2.0, density: 1.5 }, { dim: 1, radius: 1.5, density: 1.0 }],
  property:    [{ dim: 3, radius: 1.5, density: 1.0 }, { dim: 1, radius: 1.0, density: 1.0 }],
  particle:    [{ dim: 3, radius: 1.5, density: 1.5 }, { dim: 1, radius: 1.0, density: 1.0 }],
  entity:      [{ dim: 1, radius: 1.5, density: 1.0 }, { dim: 8, radius: 1.5, density: 1.0 }],
  process:     [{ dim: 3, radius: 2.0, density: 1.5 }, { dim: 8, radius: 1.5, density: 1.0 }],
  substance:   [{ dim: 1, radius: 1.0, density: 1.0 }, { dim: 8, radius: 1.5, density: 1.0 }, { dim: 3, radius: 1.0, density: 1.0 }],
  structure:   [{ dim: 1, radius: 1.5, density: 1.0 }, { dim: 3, radius: 2.0, density: 1.5 }],
  concept:     [{ dim: 3, radius: 1.5, density: 1.0 }, { dim: 2, radius: 1.0, density: 1.0 }],
  discipline:  [{ dim: 3, radius: 2.0, density: 2.0 }, { dim: 2, radius: 1.5, density: 1.0 }],
  phenomenon:  [{ dim: 1, radius: 1.5, density: 1.0 }, { dim: 8, radius: 1.5, density: 1.0 }, { dim: 3, radius: 1.0, density: 1.0 }],
  unknown:     [{ dim: 3, radius: 1.0, density: 1.0 }],
};

/** Get the engine agent ID (cached after first call) */
let _engineAgentId: string | null = null;
async function getEngineAgentId(): Promise<string> {
  if (_engineAgentId) return _engineAgentId;
  const rows = await sql("SELECT id FROM agents WHERE external_id = 'engine_v1'");
  _engineAgentId = rows[0]?.id;
  return _engineAgentId!;
}

/** Auto-assign concept spheres when a noun is created */
async function assignDimensions(nounId: number, nounType: string): Promise<void> {
  const agentId = await getEngineAgentId();
  const dims = TYPE_DIMENSIONS[nounType] || TYPE_DIMENSIONS.unknown;
  for (const d of dims) {
    await sql(
      `INSERT INTO concept_spheres (noun_id, agent_id, dimension, radius, density)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [nounId, agentId, d.dim, d.radius, d.density]
    );
  }
}

/** Increment usage tracking on a noun */
async function trackUsage(nounId: number): Promise<void> {
  await sql(
    "UPDATE nouns SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = NOW() WHERE id = $1",
    [nounId]
  );
}

// ── RTSG Core Operations ──

/** computeSupport: which dimensions contain this concept */
async function computeSupport(nounLabel: string): Promise<any> {
  const noun = await findNoun(nounLabel);
  if (!noun) return null;
  await trackUsage(noun.id);

  const spheres = await sql(
    `SELECT cs.dimension, cs.radius, cs.density, cs.position_x, cs.position_y, cs.position_z
     FROM concept_spheres cs WHERE cs.noun_id = $1
     ORDER BY cs.dimension`,
    [noun.id]
  );

  return {
    noun: noun.label,
    type: noun.type,
    glyph: getGlyph(noun.label, noun.type),
    dimensions: spheres.map((s: any) => ({
      dimension: s.dimension,
      name: DIMENSIONS[s.dimension]?.name,
      glyph: DIMENSIONS[s.dimension]?.glyph,
      radius: s.radius,
      density: s.density,
      position: { x: s.position_x, y: s.position_y, z: s.position_z },
    })),
    support: spheres.map((s: any) => s.dimension),
    span: spheres.length / 8,
  };
}

/** computeNerve: build the simplicial complex from all concept supports */
async function computeNerve(): Promise<any> {
  const agentId = await getEngineAgentId();

  // Get all concept supports (which dimensions each noun lives in)
  const supports = await sql(
    `SELECT n.id, n.label, n.type, array_agg(cs.dimension ORDER BY cs.dimension) as dims
     FROM concept_spheres cs
     JOIN nouns n ON n.id = cs.noun_id
     WHERE cs.agent_id = $1
     GROUP BY n.id, n.label, n.type`,
    [agentId]
  );

  // Build dimensional intersection counts
  // For each pair of dimensions, count how many concepts share both
  const dimPairs: Record<string, { dims: number[]; concepts: string[]; weight: number }> = {};

  for (const s of supports) {
    const dims: number[] = s.dims;
    // Each subset of dims is a potential simplex
    // For efficiency, just do vertices (single dims) and edges (pairs)
    for (let i = 0; i < dims.length; i++) {
      const key1 = `[${dims[i]}]`;
      if (!dimPairs[key1]) dimPairs[key1] = { dims: [dims[i]], concepts: [], weight: 0 };
      dimPairs[key1].concepts.push(s.label);
      dimPairs[key1].weight += 1;

      for (let j = i + 1; j < dims.length; j++) {
        const key2 = `[${dims[i]},${dims[j]}]`;
        if (!dimPairs[key2]) dimPairs[key2] = { dims: [dims[i], dims[j]], concepts: [], weight: 0 };
        dimPairs[key2].concepts.push(s.label);
        dimPairs[key2].weight += 1;
      }
    }
  }

  // Store nerve simplices
  for (const [_key, simplex] of Object.entries(dimPairs)) {
    await sql(
      `INSERT INTO nerve_simplices (agent_id, vertices, simplex_dim, weight, concept_count, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (agent_id, vertices) DO UPDATE SET weight = $4, concept_count = $5, computed_at = NOW()`,
      [agentId, simplex.dims, simplex.dims.length - 1, simplex.weight, simplex.concepts.length]
    );
  }

  // Build the nerve complex output
  const vertices = Object.values(dimPairs)
    .filter(s => s.dims.length === 1)
    .map(s => ({
      dimension: s.dims[0],
      name: DIMENSIONS[s.dims[0]]?.name,
      glyph: DIMENSIONS[s.dims[0]]?.glyph,
      concept_count: s.concepts.length,
      concepts: s.concepts,
    }));

  const edges = Object.values(dimPairs)
    .filter(s => s.dims.length === 2)
    .map(s => ({
      dimensions: s.dims,
      names: s.dims.map(d => DIMENSIONS[d]?.name),
      glyphs: s.dims.map(d => DIMENSIONS[d]?.glyph),
      shared_concepts: s.concepts.length,
      concepts: s.concepts,
    }));

  // Compute Betti numbers from the nerve
  const b0 = vertices.length; // connected components ≈ dimensions with concepts
  const b1 = Math.max(0, edges.length - vertices.length + 1); // first homology (loops)

  return {
    vertices,
    edges,
    total_simplices: Object.keys(dimPairs).length,
    betti: { b0, b1 },
    dimensional_span: vertices.length / 8,
  };
}

/** computeSheafSection: sphere data for a concept across its dimensions */
async function computeSheafSection(nounLabel: string): Promise<any> {
  const support = await computeSupport(nounLabel);
  if (!support) return null;

  const agentId = await getEngineAgentId();

  // For each dimension this concept lives in, get its sphere data
  // plus the neighbors that share that dimension
  const sections: any[] = [];
  for (const dim of support.dimensions) {
    // Get other concepts in this dimension
    const cohabitants = await sql(
      `SELECT n.label, n.type, cs.radius, cs.density
       FROM concept_spheres cs
       JOIN nouns n ON n.id = cs.noun_id
       WHERE cs.dimension = $1 AND cs.agent_id = $2 AND n.label != $3
       ORDER BY cs.radius DESC LIMIT 5`,
      [dim.dimension, agentId, nounLabel]
    );

    sections.push({
      dimension: dim.dimension,
      name: dim.name,
      glyph: dim.glyph,
      sphere: { radius: dim.radius, density: dim.density, position: dim.position },
      cohabitants: cohabitants.map((c: any) => ({
        label: c.label,
        glyph: getGlyph(c.label, c.type),
        radius: c.radius,
        density: c.density,
      })),
    });

    // Store sheaf section data
    const noun = await findNoun(nounLabel);
    if (noun) {
      // Find or create the simplex for this dimension
      const simplexRows = await sql(
        `SELECT id FROM nerve_simplices WHERE agent_id = $1 AND vertices = $2`,
        [agentId, [dim.dimension]]
      );
      if (simplexRows.length > 0) {
        await sql(
          `INSERT INTO sheaf_sections (agent_id, simplex_id, noun_id, section_data, is_global, computed_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (agent_id, simplex_id, noun_id) DO UPDATE SET section_data = $4, computed_at = NOW()`,
          [agentId, simplexRows[0].id, noun.id, JSON.stringify(dim), support.dimensions.length === 1]
        );
      }
    }
  }

  // Check global consistency: can local sections glue?
  // H¹ = 0 means the concept is coherent across all its dimensions
  // Obstruction = contradictions between dimensional views
  const isGlobal = support.dimensions.length <= 1 || checkCoherence(sections);

  return {
    noun: support.noun,
    type: support.type,
    glyph: support.glyph,
    support: support.support,
    span: support.span,
    sections,
    is_global: isGlobal,
    cohomology: { H1: isGlobal ? 0 : 1 },
  };
}

/** Check if sections are coherent (can glue to global section) */
function checkCoherence(sections: any[]): boolean {
  // Simple coherence check: densities should not wildly diverge across dimensions
  // (A concept that's dense=5 in one dim and dense=0.1 in another has tension)
  if (sections.length <= 1) return true;
  const densities = sections.map(s => s.sphere.density);
  const maxD = Math.max(...densities);
  const minD = Math.min(...densities);
  // Ratio > 10 = likely incoherent
  return maxD / minD < 10;
}

/** checkGlobalConsistency: find all global sections (fully coherent concepts) */
async function findGlobalSections(): Promise<any[]> {
  const agentId = await getEngineAgentId();
  const concepts = await sql(
    `SELECT DISTINCT n.label, n.type, n.link_count
     FROM concept_spheres cs
     JOIN nouns n ON n.id = cs.noun_id
     WHERE cs.agent_id = $1
     ORDER BY n.link_count DESC`,
    [agentId]
  );

  const globals: any[] = [];
  for (const c of concepts) {
    const section = await computeSheafSection(c.label);
    if (section && section.is_global) {
      globals.push({
        noun: c.label,
        type: c.type,
        glyph: getGlyph(c.label, c.type),
        dimensions: section.support,
        span: section.span,
        link_count: c.link_count,
      });
    }
  }
  return globals;
}

/** checkObstruction: which dimensions create incoherence for a concept */
async function checkObstruction(nounLabel: string): Promise<any> {
  const section = await computeSheafSection(nounLabel);
  if (!section) return null;
  if (section.is_global) {
    return {
      noun: section.noun,
      glyph: section.glyph,
      is_global: true,
      H1: 0,
      obstructions: [],
      ideagram: `${section.glyph} [${section.sections.map((s: any) => `${s.glyph}✓`).join(" ")}] H¹=0`,
    };
  }

  // Find which dimension pairs have density tension
  const obstructions: any[] = [];
  for (let i = 0; i < section.sections.length; i++) {
    for (let j = i + 1; j < section.sections.length; j++) {
      const ratio = section.sections[i].sphere.density / section.sections[j].sphere.density;
      if (ratio > 5 || ratio < 0.2) {
        obstructions.push({
          dim_a: section.sections[i].dimension,
          dim_b: section.sections[j].dimension,
          density_ratio: ratio,
          tension: "high",
        });
      }
    }
  }

  return {
    noun: section.noun,
    glyph: section.glyph,
    is_global: false,
    H1: obstructions.length,
    obstructions,
    ideagram: `${section.glyph} [${section.sections.map((s: any) => {
      const hasObs = obstructions.some((o: any) => o.dim_a === s.dimension || o.dim_b === s.dimension);
      return `${s.glyph}${hasObs ? "✗" : "✓"}`;
    }).join(" ")}] H¹≠0`,
  };
}

/** computeBlobDiagnostics: fill ratio, nexus index, fragmentation, Betti numbers */
async function computeBlobDiagnostics(): Promise<any> {
  const agentId = await getEngineAgentId();

  // Total possible slots: nouns × 8 dimensions
  const nounCount = await sql("SELECT COUNT(*) as count FROM nouns");
  const sphereCount = await sql("SELECT COUNT(*) as count FROM concept_spheres WHERE agent_id = $1", [agentId]);
  const totalSlots = parseInt(nounCount[0].count) * 8;
  const filledSlots = parseInt(sphereCount[0].count);
  const fillRatio = totalSlots > 0 ? filledSlots / totalSlots : 0;

  // Weighted fill: sum of (radius × density) / max possible
  const weightedSum = await sql(
    "SELECT COALESCE(SUM(radius * density), 0) as ws FROM concept_spheres WHERE agent_id = $1",
    [agentId]
  );
  const maxWeighted = filledSlots * 25; // max radius=5, max density=5
  const weightedFill = maxWeighted > 0 ? parseFloat(weightedSum[0].ws) / maxWeighted : 0;

  // Nexus index: average link_count of concepts in the system
  const nexus = await sql(
    "SELECT COALESCE(AVG(n.link_count), 0) as avg_links FROM nouns n WHERE n.id IN (SELECT DISTINCT noun_id FROM concept_spheres WHERE agent_id = $1)",
    [agentId]
  );
  const nexusIndex = parseFloat(nexus[0].avg_links);

  // Fragmentation: number of connected components (concepts with no relations)
  const isolated = await sql(
    "SELECT COUNT(*) as count FROM nouns n WHERE n.link_count = 0 AND n.id IN (SELECT DISTINCT noun_id FROM concept_spheres WHERE agent_id = $1)",
    [agentId]
  );

  // Get nerve for Betti numbers
  const nerve = await computeNerve();

  const diagnostics = {
    fill_ratio: Math.round(fillRatio * 1000) / 1000,
    weighted_fill: Math.round(weightedFill * 1000) / 1000,
    nexus_index: Math.round(nexusIndex * 100) / 100,
    fragmentation: parseInt(isolated[0].count),
    betti: nerve.betti,
    total_nouns: parseInt(nounCount[0].count),
    total_spheres: filledSlots,
    total_slots: totalSlots,
    dimensional_span: nerve.dimensional_span,
  };

  // Cache in blob_diagnostics table
  await sql(
    `INSERT INTO blob_diagnostics (agent_id, fill_ratio, weighted_fill, nexus_index, fragmentation, betti, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [agentId, diagnostics.fill_ratio, diagnostics.weighted_fill, diagnostics.nexus_index,
     diagnostics.fragmentation, JSON.stringify(diagnostics.betti)]
  );

  return diagnostics;
}

/** computeCompositeDensity: total cognitive mass at a concept */
async function computeCompositeDensity(nounLabel: string): Promise<any> {
  const support = await computeSupport(nounLabel);
  if (!support) return null;

  const totalDensity = support.dimensions.reduce(
    (sum: number, d: any) => sum + d.density * d.radius * d.radius, 0
  );
  const totalVolume = support.dimensions.reduce(
    (sum: number, d: any) => sum + (4 / 3) * Math.PI * Math.pow(d.radius, 3), 0
  );

  return {
    noun: support.noun,
    glyph: support.glyph,
    composite_density: Math.round(totalDensity * 100) / 100,
    composite_volume: Math.round(totalVolume * 100) / 100,
    dimensions: support.dimensions.map((d: any) => ({
      dim: d.dimension,
      glyph: d.glyph,
      contribution: Math.round(d.density * d.radius * d.radius * 100) / 100,
    })),
  };
}

/** Build dimension bar ideagram: ⬇️ [🗺️▆ 🔢█ 🌿▃] */
function buildDimensionBar(support: any): string {
  if (!support || !support.dimensions || support.dimensions.length === 0) return "";
  const bars = support.dimensions.map((d: any) => {
    const fill = Math.min(1, d.radius / 5); // normalize to 0-1
    const bar = fill > 0.8 ? "█" : fill > 0.6 ? "▇" : fill > 0.4 ? "▆" : fill > 0.2 ? "▃" : "▁";
    return `${d.glyph}${bar}`;
  });
  return `${support.glyph} [${bars.join(" ")}]`;
}

/** Find primes in a dimension: concepts with no inbound decomposition relations */
async function findPrimes(dimension: number): Promise<any[]> {
  const agentId = await getEngineAgentId();
  const primes = await sql(
    `SELECT n.label, n.type, n.link_count, cs.radius, cs.density
     FROM concept_spheres cs
     JOIN nouns n ON n.id = cs.noun_id
     WHERE cs.dimension = $1 AND cs.agent_id = $2
     AND n.id NOT IN (
       SELECT r.to_id FROM relations r
       WHERE r.type IN ('composed_of', 'part_of', 'contains')
       AND r.from_id IN (
         SELECT cs2.noun_id FROM concept_spheres cs2
         WHERE cs2.dimension = $1 AND cs2.agent_id = $2
       )
     )
     ORDER BY n.link_count ASC`,
    [dimension, agentId]
  );
  return primes.map((p: any) => ({
    label: p.label,
    glyph: getGlyph(p.label, p.type),
    type: p.type,
    radius: p.radius,
    density: p.density,
    link_count: p.link_count,
  }));
}

/** Find compounds in a dimension: concepts that ARE decomposed from primes */
async function findCompounds(dimension: number): Promise<any[]> {
  const agentId = await getEngineAgentId();
  const compounds = await sql(
    `SELECT n.label, n.type, n.link_count, cs.radius, cs.density
     FROM concept_spheres cs
     JOIN nouns n ON n.id = cs.noun_id
     WHERE cs.dimension = $1 AND cs.agent_id = $2
     AND n.id IN (
       SELECT r.to_id FROM relations r
       WHERE r.type IN ('composed_of', 'part_of', 'contains')
       AND r.from_id IN (
         SELECT cs2.noun_id FROM concept_spheres cs2
         WHERE cs2.dimension = $1 AND cs2.agent_id = $2
       )
     )
     ORDER BY n.link_count DESC`,
    [dimension, agentId]
  );
  return compounds.map((c: any) => ({
    label: c.label,
    glyph: getGlyph(c.label, c.type),
    type: c.type,
    radius: c.radius,
    density: c.density,
    link_count: c.link_count,
  }));
}

/** Compute intelligence metrics for the whole system */
async function computeSystemIntelligence(): Promise<any> {
  const agentId = await getEngineAgentId();

  // Cognitive density: Σ(density × radius²) / total_spheres
  const densityResult = await sql(
    `SELECT COALESCE(SUM(density * radius * radius), 0) as total_density,
            COUNT(*) as sphere_count
     FROM concept_spheres WHERE agent_id = $1`,
    [agentId]
  );
  const cognitiveDensity = parseInt(densityResult[0].sphere_count) > 0
    ? parseFloat(densityResult[0].total_density) / parseInt(densityResult[0].sphere_count)
    : 0;

  // Novelty: average freshness (1/age in days)
  const noveltyResult = await sql(
    `SELECT COALESCE(AVG(1.0 / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - COALESCE(last_used_at, created_at))) / 86400)), 0) as avg_novelty
     FROM nouns WHERE id IN (SELECT DISTINCT noun_id FROM concept_spheres WHERE agent_id = $1)`,
    [agentId]
  );
  const novelty = parseFloat(noveltyResult[0].avg_novelty);

  // Connectivity: edges / (nodes × (nodes-1) / 2)
  const edgeCount = await sql("SELECT COUNT(*) as count FROM relations");
  const nodeCount = await sql("SELECT COUNT(*) as count FROM nouns WHERE link_count > 0");
  const n = parseInt(nodeCount[0].count);
  const e = parseInt(edgeCount[0].count);
  const maxEdges = n * (n - 1) / 2;
  const connectivity = maxEdges > 0 ? e / maxEdges : 0;

  // Dimensional span
  const dimSpan = await sql(
    `SELECT COUNT(DISTINCT dimension) as dims FROM concept_spheres WHERE agent_id = $1`,
    [agentId]
  );
  const span = parseInt(dimSpan[0].dims) / 8;

  // Compound ratio
  let totalPrimes = 0;
  let totalCompounds = 0;
  for (let d = 1; d <= 8; d++) {
    const p = await findPrimes(d);
    const c = await findCompounds(d);
    totalPrimes += p.length;
    totalCompounds += c.length;
  }
  const compoundRatio = (totalPrimes + totalCompounds) > 0
    ? totalCompounds / (totalPrimes + totalCompounds)
    : 0;

  // Utility = ρ_c × κ × σ × (1 + ν)
  const utility = cognitiveDensity * connectivity * span * (1 + novelty);

  return {
    cognitive_density: Math.round(cognitiveDensity * 100) / 100,
    novelty: Math.round(novelty * 1000) / 1000,
    connectivity: Math.round(connectivity * 1000) / 1000,
    compound_ratio: Math.round(compoundRatio * 1000) / 1000,
    dimensional_span: Math.round(span * 1000) / 1000,
    utility: Math.round(utility * 100) / 100,
    total_primes: totalPrimes,
    total_compounds: totalCompounds,
    total_nouns: n,
    total_relations: e,
    ideagram: `🧠 ρ=${Math.round(cognitiveDensity * 10) / 10} κ=${Math.round(connectivity * 100) / 100} σ=${parseInt(dimSpan[0].dims)}/8 U=${Math.round(utility * 10) / 10}`,
  };
}

/** Build the cloud of spheres: compounds at top, primes at bottom, per dimension */
async function buildCloud(): Promise<any> {
  const agentId = await getEngineAgentId();

  const dimensions: any[] = [];
  for (let d = 1; d <= 8; d++) {
    const spheres = await sql(
      `SELECT n.label, n.type, n.link_count, COALESCE(n.usage_count, 0) as usage_count,
              n.last_used_at, cs.radius, cs.density
       FROM concept_spheres cs
       JOIN nouns n ON n.id = cs.noun_id
       WHERE cs.dimension = $1 AND cs.agent_id = $2
       ORDER BY n.link_count DESC`,
      [d, agentId]
    );

    if (spheres.length === 0) continue;

    const primes = await findPrimes(d);
    const compounds = await findCompounds(d);
    const primeLabels = new Set(primes.map((p: any) => p.label));

    // Compute volume and vertical rank for each sphere
    const ranked = spheres.map((s: any, i: number) => {
      const freshness = s.last_used_at
        ? 1.0 / (1.0 + (Date.now() - new Date(s.last_used_at).getTime()) / 86400000)
        : 0.5;
      const volume = Math.cbrt((s.link_count || 1) * (s.usage_count || 1) * freshness);

      return {
        noun: s.label,
        glyph: getGlyph(s.label, s.type),
        type: s.type,
        radius: s.radius,
        density: s.density,
        volume: Math.round(volume * 100) / 100,
        vertical_rank: i + 1,
        is_prime: primeLabels.has(s.label),
        link_count: s.link_count,
        usage_count: s.usage_count,
        freshness: Math.round(freshness * 100) / 100,
      };
    });

    dimensions.push({
      dimension: d,
      name: DIMENSIONS[d]?.name,
      glyph: DIMENSIONS[d]?.glyph,
      primes: primes.map((p: any) => p.label),
      compounds: compounds.map((c: any) => c.label),
      sphere_count: spheres.length,
      spheres: ranked,
    });
  }

  const systemMetrics = await computeSystemIntelligence();

  return {
    cloud: { dimensions, system_metrics: systemMetrics },
    ideagram: systemMetrics.ideagram,
  };
}

// ============================================================
// HTTP SERVER
// ============================================================

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

const server = Bun.serve({
  port: 9877,
  hostname: "127.0.0.1",

  async fetch(req) {
    const url = new URL(req.url);
    // Strip /engine prefix (Caddy sends /engine/health, we route on /health)
    const path = url.pathname.replace(/^\/engine/, "") || "/";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: HEADERS });
    }

    try {
      // ── Health ──
      if (path === "/health" || path === "/") {
        const nouns = await sql("SELECT COUNT(*) as count FROM nouns");
        const rels = await sql("SELECT COUNT(*) as count FROM relations");
        return json({
          status: "ok",
          engine: "intelligence_engine_v1",
          database: "postgresql",
          nouns: parseInt(nouns[0].count),
          relations: parseInt(rels[0].count),
          uptime_s: Math.floor((Date.now() - metrics.start_time) / 1000),
          metrics,
        });
      }

      // ── Chat / Reason ──
      if (path === "/chat" && req.method === "POST") {
        const body = await req.json();
        const message = body.message?.trim();
        if (!message) {
          return json({ error: "message required" }, 400);
        }
        const result = await reason(message);
        return json(result);
      }

      // ── Graph view (most connected) ──
      if (path === "/graph") {
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const rows = await sql(
          "SELECT label, type, link_count, in_count, out_count, created_at FROM v_graph LIMIT $1",
          [limit]
        );
        return json({ view: "graph", count: rows.length, nouns: rows });
      }

      // ── Tree view (hierarchical) ──
      if (path === "/tree") {
        const rows = await sql("SELECT * FROM v_tree LIMIT 200");
        return json({ view: "tree", count: rows.length, edges: rows });
      }

      // ── Token view (flat ordered) ──
      if (path === "/tokens") {
        const orderBy = url.searchParams.get("order") || "links";
        const limit = parseInt(url.searchParams.get("limit") || "100");
        let rows;
        if (orderBy === "age") {
          rows = await sql(
            "SELECT label, type, link_count, rank_by_age FROM v_tokens ORDER BY rank_by_age LIMIT $1",
            [limit]
          );
        } else {
          rows = await sql(
            "SELECT label, type, link_count, rank_by_links FROM v_tokens ORDER BY rank_by_links LIMIT $1",
            [limit]
          );
        }
        return json({
          view: "tokens",
          order: orderBy,
          count: rows.length,
          tokens: rows,
        });
      }

      // ── Neighbors of a noun ──
      if (path === "/neighbors") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const noun = await findNoun(label);
        if (!noun)
          return json({ error: "noun not found", query: label }, 404);
        const neighbors = await getNeighbors(noun.id);
        return json({
          noun: noun.label,
          type: noun.type,
          link_count: noun.link_count,
          neighbors,
        });
      }

      // ── Path between two nouns ──
      if (path === "/path") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to)
          return json({ error: "from and to params required" }, 400);
        const pathResult = await findPath(from, to);
        return json({
          from,
          to,
          path: pathResult,
          found: pathResult !== null,
        });
      }

      // ── Recent nouns ──
      if (path === "/recent") {
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const rows = await sql(
          "SELECT label, type, link_count, created_at, age FROM v_recent LIMIT $1",
          [limit]
        );
        return json({ view: "recent", count: rows.length, nouns: rows });
      }

      // ── Stats ──
      if (path === "/stats") {
        const nounTypes = await sql(
          "SELECT type, COUNT(*) as count FROM nouns GROUP BY type ORDER BY count DESC"
        );
        const relTypes = await sql(
          "SELECT type, COUNT(*) as count FROM relations GROUP BY type ORDER BY count DESC"
        );
        const topNouns = await sql(
          "SELECT label, type, link_count FROM nouns ORDER BY link_count DESC LIMIT 10"
        );
        return json({
          metrics,
          noun_types: nounTypes,
          relation_types: relTypes,
          top_nouns: topNouns,
          uptime_s: Math.floor((Date.now() - metrics.start_time) / 1000),
        });
      }

      // ── Create noun ──
      if (path === "/noun" && req.method === "POST") {
        const body = await req.json();
        if (!body.label) return json({ error: "label required" }, 400);
        const noun = await upsertNoun(
          body.label,
          body.type || "concept",
          body.properties || {}
        );
        return json({ created: noun });
      }

      // ── Create relation ──
      if (path === "/relation" && req.method === "POST") {
        const body = await req.json();
        if (!body.from || !body.to)
          return json({ error: "from and to required" }, 400);
        const from = await findNoun(body.from);
        const to = await findNoun(body.to);
        if (!from)
          return json({ error: "noun not found: " + body.from }, 404);
        if (!to) return json({ error: "noun not found: " + body.to }, 404);
        const rel = await upsertRelation(
          from.id,
          to.id,
          body.type || "relates_to",
          body.weight || 1.0,
          body.source || "api"
        );
        return json({ created: rel, from: from.label, to: to.label });
      }

      // ── Ideagram: Get visual representation (now with dimension bars) ──
      if (path === "/ideagram" && req.method === "GET") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const noun = await findNoun(label);
        if (!noun) return json({ error: "noun not found", query: label }, 404);
        await trackUsage(noun.id);
        const ideagram = await buildIdeagram(noun);
        // Add RTSG dimension bars
        const support = await computeSupport(label);
        const dimBar = support ? buildDimensionBar(support) : null;
        return json({ ...ideagram, dimension_bar: dimBar, support: support?.dimensions || [] });
      }

      // ── Ideagram: Set custom glyph ──
      if (path === "/ideagram" && req.method === "POST") {
        const body = await req.json();
        if (!body.noun || !body.glyph) return json({ error: "noun and glyph required" }, 400);
        const noun = await findNoun(body.noun);
        if (!noun) return json({ error: "noun not found: " + body.noun }, 404);
        // Store glyph in properties
        const props = noun.properties || {};
        props.glyph = body.glyph;
        await sql("UPDATE nouns SET properties = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(props), noun.id]);
        // Also update in-memory map
        NOUN_GLYPHS[noun.label] = body.glyph;
        return json({ noun: noun.label, glyph: body.glyph, stored: true });
      }

      // ── Ideagram: Formula path ──
      if (path === "/ideagram/formula") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) return json({ error: "from and to params required" }, 400);
        const formula = await buildFormulaPath(from, to);
        if (!formula) return json({ from, to, found: false, glyph_formula: null }, 200);
        return json({ ...formula, found: true });
      }

      // ── Ideagram: Full graph as visual ──
      if (path === "/ideagram/graph") {
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const rows = await sql("SELECT label, type, link_count FROM v_graph LIMIT $1", [limit]);
        const glyphs = rows.map((r: any) => ({
          label: r.label,
          glyph: getGlyph(r.label, r.type),
          type: r.type,
          links: r.link_count,
        }));
        return json({ view: "ideagram_graph", count: glyphs.length, glyphs });
      }

      // ============================================================
      // RTSG ENDPOINTS — Phase Space, Sheaf, Blob, Intelligence
      // ============================================================

      // ── Sheaf: Nerve complex ──
      if (path === "/sheaf/nerve") {
        const nerve = await computeNerve();
        return json(nerve);
      }

      // ── Sheaf: Section for a concept ──
      if (path === "/sheaf/section") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const section = await computeSheafSection(label);
        if (!section) return json({ error: "noun not found", query: label }, 404);
        const dimBar = buildDimensionBar(await computeSupport(label));
        return json({ ...section, ideagram: dimBar });
      }

      // ── Sheaf: Global sections (fully coherent concepts) ──
      if (path === "/sheaf/global") {
        const globals = await findGlobalSections();
        return json({
          count: globals.length,
          global_sections: globals,
          ideagram: globals.map((g: any) => `${g.glyph}✓`).join(" "),
        });
      }

      // ── Sheaf: Obstruction (incoherence check) ──
      if (path === "/sheaf/obstruction") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const obstruction = await checkObstruction(label);
        if (!obstruction) return json({ error: "noun not found", query: label }, 404);
        return json(obstruction);
      }

      // ── Sheaf: Support (dimensions of a concept) ──
      if (path === "/sheaf/support") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const support = await computeSupport(label);
        if (!support) return json({ error: "noun not found", query: label }, 404);
        return json({ ...support, ideagram: buildDimensionBar(support) });
      }

      // ── Blob: Diagnostics ──
      if (path === "/blob/diagnostics") {
        const diagnostics = await computeBlobDiagnostics();
        return json({
          ...diagnostics,
          ideagram: `🧠 fill=${diagnostics.fill_ratio} nexus=${diagnostics.nexus_index} frag=${diagnostics.fragmentation} β=[${diagnostics.betti.b0},${diagnostics.betti.b1}]`,
        });
      }

      // ── Blob: Composite density at a concept ──
      if (path === "/blob/density") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const density = await computeCompositeDensity(label);
        if (!density) return json({ error: "noun not found", query: label }, 404);
        return json(density);
      }

      // ── Intelligence: System metrics ──
      if (path === "/intelligence/system") {
        const intel = await computeSystemIntelligence();
        return json(intel);
      }

      // ── Intelligence: Single concept ──
      if (path === "/intelligence" && req.method === "GET") {
        const label = url.searchParams.get("noun");
        if (!label) return json({ error: "noun param required" }, 400);
        const support = await computeSupport(label);
        if (!support) return json({ error: "noun not found", query: label }, 404);
        const density = await computeCompositeDensity(label);
        const section = await computeSheafSection(label);
        return json({
          noun: support.noun,
          glyph: support.glyph,
          cognitive_density: density?.composite_density || 0,
          volume: density?.composite_volume || 0,
          dimensional_span: support.span,
          is_coherent: section?.is_global || false,
          H1: section?.cohomology?.H1 || 0,
          dimensions: support.dimensions,
          ideagram: buildDimensionBar(support),
        });
      }

      // ── Intelligence: Ranking (all concepts by utility) ──
      if (path === "/intelligence/ranking") {
        const agentId = await getEngineAgentId();
        const concepts = await sql(
          `SELECT n.label, n.type, n.link_count, COALESCE(n.usage_count, 0) as usage_count,
                  COALESCE(SUM(cs.density * cs.radius * cs.radius), 0) as cognitive_mass,
                  COUNT(cs.dimension) as dim_count
           FROM nouns n
           LEFT JOIN concept_spheres cs ON cs.noun_id = n.id AND cs.agent_id = $1
           GROUP BY n.id, n.label, n.type, n.link_count, n.usage_count
           ORDER BY cognitive_mass DESC, n.link_count DESC`,
          [agentId]
        );
        return json({
          count: concepts.length,
          ranking: concepts.map((c: any, i: number) => ({
            rank: i + 1,
            noun: c.label,
            glyph: getGlyph(c.label, c.type),
            type: c.type,
            cognitive_mass: Math.round(parseFloat(c.cognitive_mass) * 100) / 100,
            link_count: c.link_count,
            usage_count: c.usage_count,
            dimensions: parseInt(c.dim_count),
          })),
        });
      }

      // ── Intelligence: Primes in a dimension ──
      if (path === "/intelligence/primes") {
        const dim = parseInt(url.searchParams.get("dim") || "0");
        if (dim < 1 || dim > 8) return json({ error: "dim must be 1-8" }, 400);
        const primes = await findPrimes(dim);
        return json({
          dimension: dim,
          name: DIMENSIONS[dim]?.name,
          glyph: DIMENSIONS[dim]?.glyph,
          count: primes.length,
          primes,
        });
      }

      // ── Intelligence: Compounds in a dimension ──
      if (path === "/intelligence/compounds") {
        const dim = parseInt(url.searchParams.get("dim") || "0");
        if (dim < 1 || dim > 8) return json({ error: "dim must be 1-8" }, 400);
        const compounds = await findCompounds(dim);
        return json({
          dimension: dim,
          name: DIMENSIONS[dim]?.name,
          glyph: DIMENSIONS[dim]?.glyph,
          count: compounds.length,
          compounds,
        });
      }

      // ── Intelligence: Cloud of Spheres ──
      if (path === "/intelligence/cloud") {
        const cloud = await buildCloud();
        return json(cloud);
      }

      // ── Priority tuple ──
      if (path === "/priority") {
        return json({
          description: "The ordered set of what matters most. Agent zero is rank 0.",
          tuple: PRIORITY_TUPLE,
          ideagram: PRIORITY_TUPLE.map(p => p.glyph).join(" → "),
        });
      }

      // ── Dimensions (reference) ──
      if (path === "/dimensions") {
        return json({
          count: 8,
          dimensions: Object.entries(DIMENSIONS).map(([k, v]) => ({
            dimension: parseInt(k),
            ...v,
          })),
        });
      }

      // ── Agents ──
      if (path === "/agents") {
        const agents = await sql("SELECT * FROM agents ORDER BY created_at");
        return json({ count: agents.length, agents });
      }

      // ── 404 ──
      return json(
        {
          error: "not found",
          endpoints: [
            "GET /engine/health",
            "POST /engine/chat",
            "GET /engine/graph",
            "GET /engine/tree",
            "GET /engine/tokens",
            "GET /engine/neighbors?noun=X",
            "GET /engine/path?from=X&to=Y",
            "GET /engine/recent",
            "GET /engine/stats",
            "POST /engine/noun",
            "POST /engine/relation",
            "GET /engine/ideagram?noun=X",
            "POST /engine/ideagram",
            "GET /engine/ideagram/formula?from=X&to=Y",
            "GET /engine/ideagram/graph",
            "── RTSG Phase Space ──",
            "GET /engine/sheaf/nerve",
            "GET /engine/sheaf/section?noun=X",
            "GET /engine/sheaf/global",
            "GET /engine/sheaf/obstruction?noun=X",
            "GET /engine/sheaf/support?noun=X",
            "GET /engine/blob/diagnostics",
            "GET /engine/blob/density?noun=X",
            "GET /engine/intelligence?noun=X",
            "GET /engine/intelligence/system",
            "GET /engine/intelligence/ranking",
            "GET /engine/intelligence/primes?dim=N",
            "GET /engine/intelligence/compounds?dim=N",
            "GET /engine/intelligence/cloud",
            "GET /engine/priority",
            "GET /engine/dimensions",
            "GET /engine/agents",
          ],
        },
        404
      );
    } catch (err: any) {
      console.error("[engine] Error:", err.message);
      return json({ error: err.message }, 500);
    }
  },
});

// Startup
console.log("[engine] Intelligence Engine running on http://127.0.0.1:9877");
console.log("[engine] Proxied at https://musclemap.me/engine/");

// Test connection on startup
sql("SELECT COUNT(*) as n FROM nouns")
  .then((rows) =>
    console.log("[engine] Connected to PostgreSQL. " + rows[0].n + " nouns in graph.")
  )
  .catch((err) =>
    console.error("[engine] DB connection failed:", err.message)
  );
