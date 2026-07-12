// 提示词排版检测 + LLM 优化
// 当组合结果存在格式问题（多余空行、标点混用、段落不清等）时自动调用 LLM 重新排版
// LLM 调用保留原意，仅调整格式

export interface FormatIssue {
  code: string;
  message: string;
}

const REPEATED_PUNCTUATION = /([，。！？、；：])\1{2,}/;
const MIXED_PUNCTUATION = /[!?;]|\s*[,，]\s*[\u4e00-\u9fa5]/;
const REPEATED_CHARS = /(.)\1{4,}/;
const TRAILING_WHITESPACE = /[\s\u3000]+$/;
const TRIPLE_NEWLINE = /\n{3,}/;
const SPACE_BEFORE_CHINESE_PUNCT = /[\u4e00-\u9fa5]\s+[，。！？、；：]/;
const SPACE_AFTER_ENGLISH_WORD_BEFORE_CHINESE = /([a-zA-Z0-9])\s+([\u4e00-\u9fa5])/;
const LONG_NO_PARAGRAPH = (text: string) => text.length > 200 && !text.includes('\n');
const PRODUCT_BLOCK_MARKER = /【产品型号】|【产品规格】|【附加备注】/;
const REPEATED_BLOCK = (text: string) => {
  // 检测重复的【产品型号】或【附加备注】块
  const matches = text.match(/【产品型号】[\s\S]*?(?=\n\n|$)/g);
  return matches ? matches.length > 1 : false;
};
const REPEATED_NOTES = (text: string) => {
  const matches = text.match(/【附加备注】[\s\S]*?(?=\n\n|$)/g);
  return matches ? matches.length > 1 : false;
};
const EMPTY_LINES = /\n\n+/g;

export function detectFormatIssues(text: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  if (!text || !text.trim()) {
    return issues;
  }
  if (TRIPLE_NEWLINE.test(text)) {
    issues.push({ code: 'multi_newlines', message: '存在连续空行' });
  }
  if (REPEATED_PUNCTUATION.test(text)) {
    issues.push({ code: 'repeated_punctuation', message: '标点符号连续重复' });
  }
  if (REPEATED_CHARS.test(text)) {
    issues.push({ code: 'repeated_chars', message: '存在连续重复字符' });
  }
  if (TRAILING_WHITESPACE.test(text)) {
    issues.push({ code: 'trailing_whitespace', message: '末尾有多余空白' });
  }
  if (MIXED_PUNCTUATION.test(text)) {
    issues.push({ code: 'mixed_punctuation', message: '中英文标点混用' });
  }
  if (SPACE_BEFORE_CHINESE_PUNCT.test(text)) {
    issues.push({ code: 'space_before_zh_punct', message: '中文标点前有空格' });
  }
  // 检测段落合并：超过 200 字没有任何空行
  if (LONG_NO_PARAGRAPH(text)) {
    issues.push({ code: 'no_paragraph_break', message: '长文本未分段' });
  }
  // 检测缺少【】标记的产品型号块（组合结果如果没有块分隔就提示）
  if (text.length > 100 && !PRODUCT_BLOCK_MARKER.test(text) && /\d{3,5}W/.test(text)) {
    issues.push({ code: 'no_product_block', message: '缺少【产品型号】块分隔' });
  }
  // 检测重复【产品型号】块
  if (REPEATED_BLOCK(text)) {
    issues.push({ code: 'repeated_product_block', message: '存在重复的【产品型号】块' });
  }
  // 检测重复【附加备注】块
  if (REPEATED_NOTES(text)) {
    issues.push({ code: 'repeated_notes_block', message: '存在重复的【附加备注】块' });
  }
  return issues;
}

export interface PolishResult {
  text: string;
  changed: boolean;
  durationMs: number;
  model?: string;
}

export async function polishPromptWithLlm(
  text: string,
  language: string | null,
  fetchFn: (payload: { text: string; language?: string }) => Promise<{ text: string; changed: boolean; duration_ms: number; model: string }>,
): Promise<PolishResult> {
  const result = await fetchFn({ text, language: language || undefined });
  return {
    text: result.text,
    changed: result.changed,
    durationMs: result.duration_ms,
    model: result.model,
  };
}

export function removeCodeBlockFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    const lines = trimmed.split('\n');
    if (lines.length >= 3) {
      return lines.slice(1, -1).join('\n').trim();
    }
  }
  return trimmed;
}
