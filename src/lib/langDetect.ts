/**
 * Idioma probable de un formulario a partir de su título y preguntas
 * (palabras frecuentes de cada idioma). Devuelve el código de
 * SUPPORTED_LANGUAGES o null si no está claro.
 */
const WORDS: Record<string, string[]> = {
  español: ["de", "la", "el", "que", "y", "en", "los", "las", "tu", "su", "cuál", "cual", "qué", "nombre", "edad", "por", "para", "con", "usted", "años", "cómo", "como"],
  inglés: ["the", "of", "and", "to", "your", "you", "what", "is", "how", "name", "age", "do", "are", "in", "for", "which", "please", "would", "with", "years"],
  portugués: ["de", "o", "a", "que", "e", "do", "da", "em", "você", "seu", "sua", "qual", "nome", "idade", "não", "para", "com", "como", "anos", "é"],
  francés: ["de", "la", "le", "et", "les", "des", "vous", "votre", "quel", "quelle", "nom", "âge", "est", "pour", "avec", "comment", "ans", "êtes", "du", "en"],
  italiano: ["il", "di", "che", "e", "la", "per", "con", "non", "una", "sono", "nome", "età", "qual", "quale", "come", "anni", "della", "del", "tuo", "tua", "è"],
};

export function detectLanguage(texts: string[]): string | null {
  const tokens = texts
    .join(" ")
    .toLowerCase()
    .split(/[^a-záéíóúñçãõâêôàèùëïüìò]+/i)
    .filter(Boolean);
  if (tokens.length < 4) return null;
  const scores = Object.entries(WORDS).map(([lang, words]) => {
    const set = new Set(words);
    return [lang, tokens.filter((t) => set.has(t)).length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  // Debe ganar con claridad (español y portugués comparten muchas palabras).
  if (best[1] < 3 || best[1] < second[1] * 1.4) return null;
  return best[0];
}
