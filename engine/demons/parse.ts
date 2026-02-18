/**
 * Parse Demon — Decomposes raw user input into structured concepts.
 *
 * This is always the FIRST demon to fire when new input arrives.
 * It takes the raw user text, breaks it into noun phrases,
 * identifies the question type, and seeds working memory with
 * structured slots for other demons to operate on.
 *
 * Inspired by RTSG Section 10: "Intelligence as measurable vector."
 * The parse demon maps raw language onto the concept space by
 * extracting what nouns are mentioned, what relations are implied,
 * and what the user's intent is (question, claim, request, etc.)
 */

import type { Demon, DemonOutput, DemonInput, MemSlot } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';

/** Simple extraction of noun-like phrases from text. */
function extractNounPhrases(text: string): string[] {
  // Remove common stop words and extract meaningful phrases
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this',
    'what', 'which', 'who', 'whom', 'these', 'those', 'i', 'me', 'my',
    'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it',
    'its', 'they', 'them', 'their', 'about', 'up', 'it\'s', 'don\'t',
    'doesn\'t', 'didn\'t', 'won\'t', 'wouldn\'t', 'can\'t', 'cannot',
    'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t',
  ]);

  const cleaned = text
    .toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter((w) => w.length > 1 && !stopWords.has(w));

  // Group consecutive non-stop words as potential noun phrases
  const phrases: string[] = [];
  let current: string[] = [];

  for (const word of cleaned.split(' ')) {
    if (stopWords.has(word) || word.length <= 1) {
      if (current.length > 0) {
        phrases.push(current.join(' '));
        current = [];
      }
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) phrases.push(current.join(' '));

  // Also return individual meaningful words as atomic nouns
  const atomic = words.filter((w) => !phrases.some((p) => p === w));

  return [...new Set([...phrases, ...atomic])];
}

/** Detect what kind of utterance this is. */
type IntentType = 'question' | 'claim' | 'request' | 'greeting' | 'confusion' | 'correction' | 'unknown';

function detectIntent(text: string): IntentType {
  const lower = text.toLowerCase().trim();

  // Greeting patterns
  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|what'?s?\s+up|howdy|yo)\b/.test(lower)) {
    return 'greeting';
  }

  // Question patterns
  if (/^(what|why|how|when|where|who|which|can|could|would|is|are|do|does|did|will)\b/.test(lower)
      || lower.endsWith('?')) {
    return 'question';
  }

  // Confusion patterns
  if (/^(i\s+don'?t\s+(understand|get|know)|confused|what\s+do\s+you\s+mean|huh|i'?m\s+lost)/i.test(lower)) {
    return 'confusion';
  }

  // Correction patterns
  if (/^(no|that'?s?\s+(not|wrong)|actually|wait|incorrect|i\s+meant)/i.test(lower)) {
    return 'correction';
  }

  // Request patterns
  if (/^(explain|tell|show|teach|help|give|describe|define|solve|calculate)/i.test(lower)) {
    return 'request';
  }

  // Claim patterns (declarative statements — anything else with meaningful content)
  if (lower.split(' ').length > 2) {
    return 'claim';
  }

  return 'unknown';
}

/** Detect subject domain from text. */
function detectSubject(text: string): string {
  const lower = text.toLowerCase();

  const subjects: [string, RegExp[]][] = [
    ['mathematics', [/math|algebra|calcul|equation|formula|geometr|trigonometr|number|fraction|decimal|percent|variable|polynomial|function|graph|slope|integral|derivat|matrix|vector|probability|statistic/]],
    ['physics', [/physics|force|motion|energy|velocity|accelerat|gravity|mass|momentum|wave|electric|magnet|quantum|relativity|thermodynamic|pressure|friction/]],
    ['chemistry', [/chemistry|chemical|atom|molecule|element|compound|reaction|bond|ion|acid|base|solution|periodic\s+table|electron|proton|neutron|molar/]],
    ['biology', [/biology|cell|organism|evolution|dna|gene|protein|ecosystem|species|photosynthesis|mitosis|meiosis|organ|tissue|bacteria|virus/]],
    ['history', [/history|war|revolution|empire|dynasty|century|ancient|medieval|colonial|civilization|democracy|monarch|president|treaty|battle/]],
    ['language', [/grammar|verb|noun|adjective|sentence|paragraph|essay|writing|read|literature|poetry|vocabulary|synonym|antonym|metaphor|simile/]],
    ['computer_science', [/code|program|algorithm|data\s*structure|software|hardware|computer|function|variable|loop|array|class|object|database|web|api|python|javascript|html|css/]],
    ['geography', [/geography|continent|country|ocean|river|mountain|climate|population|capital|border|latitude|longitude|map|terrain|region/]],
    ['economics', [/economics|market|supply|demand|price|inflation|gdp|trade|currency|bank|invest|profit|cost|revenue|tax|budget/]],
  ];

  for (const [subject, patterns] of subjects) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) return subject;
    }
  }

  return 'general';
}

/** Extract what specific question is being asked. */
function extractQuestionFocus(text: string): string {
  const lower = text.toLowerCase().trim();

  // "What is X?" -> X
  const whatIs = lower.match(/what\s+(?:is|are)\s+(.+?)[\?]?$/);
  if (whatIs) return whatIs[1].trim();

  // "How does X work?" -> X
  const howDoes = lower.match(/how\s+(?:does|do|did|can|could|would)\s+(.+?)(?:\s+work|\s+happen|\s+function)?[\?]?$/);
  if (howDoes) return howDoes[1].trim();

  // "Why does X?" -> X
  const why = lower.match(/why\s+(?:does|do|did|is|are|was|were)\s+(.+?)[\?]?$/);
  if (why) return why[1].trim();

  // "Explain X" -> X
  const explain = lower.match(/(?:explain|describe|define|tell\s+me\s+about)\s+(.+?)[\?.]?$/);
  if (explain) return explain[1].trim();

  return text.trim();
}

export const parseDemon: Demon = {
  id: 'parse',
  name: 'Parse',
  description: 'Decomposes raw user input into structured concepts, intent, subject, and noun phrases.',
  triggers: [{ type: 'new_input' }],

  run(input: DemonInput): DemonOutput {
    const rawSlot = latestByTag(input.memory, 'raw_input');
    if (!rawSlot) {
      return { write: [], evict: [], focus: [], actions: [], chain: [] };
    }

    const text = String(rawSlot.content);
    const intent = detectIntent(text);
    const subject = detectSubject(text);
    const nounPhrases = extractNounPhrases(text);
    const questionFocus = intent === 'question' || intent === 'request'
      ? extractQuestionFocus(text)
      : undefined;

    const slotsToWrite: Omit<MemSlot, 'id' | 'created_at'>[] = [];

    // Intent slot
    slotsToWrite.push({
      content: intent,
      tag: 'intent',
      confidence: 0.8,
      source_demon: 'parse',
      ttl: 0, // Lives for the session turn
    });

    // Subject slot
    slotsToWrite.push({
      content: subject,
      tag: 'subject',
      confidence: subject === 'general' ? 0.3 : 0.7,
      source_demon: 'parse',
      ttl: 0,
    });

    // Individual noun phrase slots
    for (const phrase of nounPhrases) {
      slotsToWrite.push({
        content: phrase,
        tag: 'noun_phrase',
        confidence: 0.6,
        source_demon: 'parse',
        ttl: 10, // Noun phrases decay after 10 ticks
      });
    }

    // Question focus
    if (questionFocus) {
      slotsToWrite.push({
        content: questionFocus,
        tag: 'question_focus',
        confidence: 0.7,
        source_demon: 'parse',
        ttl: 0,
      });
    }

    // Decide which demons should fire next based on intent
    const chain: string[] = [];

    switch (intent) {
      case 'question':
      case 'request':
        chain.push('relate', 'infer', 'question');
        break;
      case 'claim':
        chain.push('relate', 'infer', 'decompose');
        break;
      case 'confusion':
        chain.push('decompose', 'analogize', 'question');
        break;
      case 'correction':
        chain.push('relate', 'infer');
        break;
      case 'greeting':
        chain.push('question'); // Greet back with a question
        break;
      default:
        chain.push('relate', 'question');
    }

    return {
      write: slotsToWrite as MemSlot[],
      evict: [],
      focus: [], // Let the hypervisor manage focus from these
      actions: [{ type: 'log', message: `Parsed: intent=${intent}, subject=${subject}, nouns=[${nounPhrases.join(', ')}]` }],
      chain,
    };
  },
};
