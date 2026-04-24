export const extractJson = (modelText) => {
  if (!modelText) return null;

  const trimmed = modelText.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch?.[1]) {
    const fenced = tryParse(codeFenceMatch[1]);
    if (fenced) return fenced;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const substring = trimmed.slice(firstBrace, lastBrace + 1);
    const partial = tryParse(substring);
    if (partial) return partial;
  }

  return null;
};

const tryParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
