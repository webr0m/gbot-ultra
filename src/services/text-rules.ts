import type { PremiumTier } from './entitlements.js';

export type TextRuleAction = 'delete' | 'warn' | 'mute' | 'ban';

export interface TextRuleLimits {
  rules: number;
  terms: number;
  chars: number;
  exceptions: number;
}

/** Rule budget per tier. Premium keeps the historical budget; Pro and Ultra scale it. */
export const TEXT_RULE_LIMITS: Record<'premium' | 'pro' | 'ultra', TextRuleLimits> = {
  premium: { rules: 30, terms: 5, chars: 2000, exceptions: 30 },
  pro: { rules: 200, terms: 10, chars: 20000, exceptions: 100 },
  ultra: { rules: 500, terms: 15, chars: 50000, exceptions: 200 },
};

export const TEXT_RULE_ACTIONS: TextRuleAction[] = ['delete', 'warn', 'mute', 'ban'];
export const TERM_MAX_LENGTH = 64;
export const DURATION_MIN = 60;
export const DURATION_MAX = 2592000;

export interface TextRule {
  terms: string[];
  parts: string[][];
  action: TextRuleAction | null;
  durationSeconds: number | null;
  line: number;
}

export interface TextRuleSet {
  rules: TextRule[];
  exceptions: TextRule[];
  errors: string[];
  limitErrors: string[];
}

export function textRuleLimits(tier: PremiumTier): TextRuleLimits {
  if (tier === 'ultra') return TEXT_RULE_LIMITS.ultra;
  if (tier === 'pro') return TEXT_RULE_LIMITS.pro;
  return TEXT_RULE_LIMITS.premium;
}

const tierName = (tier: PremiumTier) => tier === 'ultra' ? 'Ultra' : tier === 'pro' ? 'Pro' : 'Premium';

function literalLength(term: string): number {
  return term.replaceAll('*', '').trim().length;
}

function parseModifiers(raw: string[], line: number, errors: string[]): { action: TextRuleAction | null; durationSeconds: number | null } {
  let action: TextRuleAction | null = null;
  let durationSeconds: number | null = null;
  for (const modifier of raw) {
    const value = modifier.trim();
    if (!value) {
      errors.push(`El modificador de la línea ${line} está vacío.`);
      continue;
    }
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      if (seconds < DURATION_MIN || seconds > DURATION_MAX) {
        errors.push(`La duración de la línea ${line} debe estar entre ${DURATION_MIN} y ${DURATION_MAX} segundos.`);
        continue;
      }
      if (durationSeconds !== null) {
        errors.push(`La línea ${line} repite la duración.`);
        continue;
      }
      durationSeconds = seconds;
      continue;
    }
    if (!TEXT_RULE_ACTIONS.includes(value as TextRuleAction)) {
      errors.push(`La acción de la línea ${line} no es válida. Usa ${TEXT_RULE_ACTIONS.join(', ')}.`);
      continue;
    }
    if (action !== null) {
      errors.push(`La línea ${line} repite la acción.`);
      continue;
    }
    action = value as TextRuleAction;
  }
  return { action, durationSeconds };
}

function parseTerms(head: string, limits: TextRuleLimits, line: number, errors: string[], limitErrors: string[]): string[] | null {
  const terms = head.split('&&').map((term) => term.trim());
  if (!terms.length || terms.some((term) => !term.length)) {
    errors.push(`La línea ${line} tiene un término vacío.`);
    return null;
  }
  if (terms.length > limits.terms) {
    limitErrors.push(`Cada regla admite hasta ${limits.terms} términos y la línea ${line} tiene ${terms.length}.`);
    return null;
  }
  for (const term of terms) {
    if (term.length > TERM_MAX_LENGTH) {
      errors.push(`El término de la línea ${line} supera los ${TERM_MAX_LENGTH} caracteres.`);
      return null;
    }
    if (literalLength(term) < 2) {
      errors.push(`Cada término necesita al menos dos caracteres literales (línea ${line}).`);
      return null;
    }
  }
  return terms;
}

/** Parses both blocks. Rules and exceptions share the term grammar; only rules carry modifiers. */
export function parseTextRules(patterns: string, exceptions: string, limits: TextRuleLimits): TextRuleSet {
  const errors: string[] = [];
  const limitErrors: string[] = [];
  const rules: TextRule[] = [];
  const parsedExceptions: TextRule[] = [];
  if (patterns.length > limits.chars) limitErrors.push(`El nivel admite hasta ${limits.chars} caracteres de patrones y ahora hay ${patterns.length}.`);
  if (exceptions.length > limits.chars) limitErrors.push(`El nivel admite hasta ${limits.chars} caracteres de excepciones y ahora hay ${exceptions.length}.`);

  const readBlock = (text: string, forceException: boolean) => {
    let rulesOver = false;
    let exceptionsOver = false;
    text.split('\n').forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const isException = forceException || line.startsWith('!');
      const body = line.replace(/^!+/, '').trim();
      if (!body) return;
      const segments = body.split('::');
      if (segments.length > 3) {
        errors.push(`La línea ${index + 1} tiene demasiados modificadores.`);
        return;
      }
      const terms = parseTerms(segments[0] ?? '', limits, index + 1, errors, limitErrors);
      if (!terms) return;
      const modifiers = parseModifiers(segments.slice(1), index + 1, errors);
      const rule: TextRule = {
        terms,
        parts: terms.map((term) => term.normalize('NFKC').toLowerCase().split('*').filter((part) => part.length > 0)),
        action: isException ? null : modifiers.action,
        durationSeconds: isException ? null : modifiers.durationSeconds,
        line: index + 1,
      };
      if (isException) {
        if (parsedExceptions.length >= limits.exceptions) {
          if (!exceptionsOver) {
            limitErrors.push(`El nivel admite hasta ${limits.exceptions} excepciones.`);
            exceptionsOver = true;
          }
          return;
        }
        parsedExceptions.push(rule);
        return;
      }
      if (rules.length >= limits.rules) {
        if (!rulesOver) {
          limitErrors.push(`El nivel admite hasta ${limits.rules} reglas y ahora hay más.`);
          rulesOver = true;
        }
        return;
      }
      rules.push(rule);
    });
  };

  readBlock(patterns, false);
  readBlock(exceptions, true);
  return { rules, exceptions: parsedExceptions, errors, limitErrors };
}

/** Keeps only the lines that fit the tier budget, so a downgrade never enforces a removed rule. */
export function clampTextRules(patterns: string, exceptions: string, limits: TextRuleLimits): { patterns: string; exceptions: string } {
  const clampBlock = (text: string, maxRules: number, maxTerms: number, maxChars: number) => {
    if (text.length <= maxChars) {
      const lines = text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
      if (lines.length <= maxRules) {
        const withinTerms = lines.every((line) => {
          const head = line.replace(/^!+/, '').split('::')[0] ?? '';
          return head.split('&&').filter((term) => term.trim().length > 0).length <= maxTerms;
        });
        if (withinTerms) return text;
      }
    }
    const kept: string[] = [];
    let rules = 0;
    let chars = 0;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        kept.push(line);
        continue;
      }
      if (rules >= maxRules) break;
      const body = line.replace(/^!+/, '').trim();
      const segments = body.split('::');
      const terms = (segments[0] ?? '').split('&&').map((term) => term.trim()).filter((term) => term.length > 0).slice(0, maxTerms);
      if (!terms.length) continue;
      const tail = body.slice((segments[0] ?? '').length);
      const rebuilt = terms.join(' && ') + tail;
      if (chars + rebuilt.length > maxChars) break;
      kept.push(rebuilt);
      chars += rebuilt.length;
      rules++;
    }
    return kept.join('\n');
  };
  return {
    patterns: clampBlock(patterns, limits.rules, limits.terms, limits.chars),
    exceptions: clampBlock(exceptions, limits.exceptions, limits.terms, limits.chars),
  };
}

function termMatches(parts: string[], text: string): boolean {
  if (!parts.length) return false;
  let offset = 0;
  for (const part of parts) {
    const index = text.indexOf(part, offset);
    if (index === -1) return false;
    offset = index + part.length;
  }
  return true;
}

export function ruleMatches(rule: TextRule, text: string): boolean {
  return rule.terms.every((_term, index) => termMatches(rule.parts[index] ?? [], text));
}

export interface TextRuleVerdict {
  matched: TextRule | null;
  allowed: boolean;
}

/** An exception always wins: the message is kept even when a rule would match. */
export function evaluateTextRules(set: TextRuleSet, text: string): TextRuleVerdict {
  const normalized = text.normalize('NFKC').toLowerCase();
  for (const exception of set.exceptions) if (ruleMatches(exception, normalized)) return { matched: null, allowed: true };
  for (const rule of set.rules) if (ruleMatches(rule, normalized)) return { matched: rule, allowed: false };
  return { matched: null, allowed: false };
}

const compiled = new Map<string, TextRuleSet>();
const COMPILED_MAX = 24;
let lastPatterns: string | null = null;
let lastExceptions: string | null = null;
let lastLimits = '';
let lastSet: TextRuleSet | null = null;

function compileKey(patterns: string, exceptions: string, limits: TextRuleLimits): string {
  return `${limits.rules}:${limits.terms}:${limits.chars}:${limits.exceptions}|${patterns}|${exceptions}`;
}

/** Compiles the rules once per configuration; the matcher runs on every incoming message. */
export function compiledTextRules(patterns: string, exceptions: string, limits: TextRuleLimits): TextRuleSet {
  const limitsKey = `${limits.rules}:${limits.terms}:${limits.chars}:${limits.exceptions}`;
  if (lastSet && lastPatterns === patterns && lastExceptions === exceptions && lastLimits === limitsKey) return lastSet;
  const key = compileKey(patterns, exceptions, limits);
  let set = compiled.get(key);
  if (!set) {
    set = parseTextRules(patterns, exceptions, limits);
    if (compiled.size >= COMPILED_MAX) compiled.delete(compiled.keys().next().value!);
    compiled.set(key, set);
  }
  lastPatterns = patterns;
  lastExceptions = exceptions;
  lastLimits = limitsKey;
  lastSet = set;
  return set;
}

export function clearTextRuleCache(): void {
  compiled.clear();
  lastPatterns = null;
  lastExceptions = null;
  lastLimits = '';
  lastSet = null;
}
