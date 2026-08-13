import {
  EMPTY_STORE_SENTENCE_MODEL_OUTPUT,
  type StoreSentenceExtractedField,
  type StoreSentenceModelOutput,
} from '@meiye/contracts';

/**
 * Fixture canned compiler for `store_sentence_extract_v1`.
 *
 * Three shapes the e2e / unit gates name:
 * 1. a full spoken line with name / city / project / price
 * 2. a half-said line (one or two fields only)
 * 3. a line that says nothing usable → all null
 *
 * Broader than the wizard regex on purpose: non-template wording such as
 * 「盘点美发工作室开在杭州，染发套餐价格三百八十八」 has to resolve here so
 * fixture e2e can prove the LLM path without a live model.
 */
export function compileFixtureStoreSentenceExtract(
  sentence: string,
): StoreSentenceModelOutput {
  const text = sentence.trim();
  if (!text) return { ...EMPTY_STORE_SENTENCE_MODEL_OUTPUT };

  return {
    name: field(extractName(text), 0.9),
    city: field(extractCity(text), 0.85),
    district: field(extractDistrict(text), 0.7),
    address: field(extractAddress(text), 0.65),
    booking: field(extractBooking(text), 0.65),
    projectName: field(extractProjectName(text), 0.8),
    projectPrice: field(extractProjectPrice(text), 0.85),
    industry: field(extractIndustry(text), 0.7),
  };
}

function field(
  value: string | undefined,
  confidence: number,
): StoreSentenceExtractedField | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return { value: trimmed, confidence };
}

function extractName(text: string) {
  return (
    firstGroup(
      text,
      /(?:我们)?店(?:名叫|叫|名是)([^，,。；;\n]+)/u,
    ) ??
    firstGroup(text, /(?:门店名称|店名)[：:]\s*([^\n：:]+)/u) ??
    firstGroup(text, /工作室是([^，,。；;\n]+)/u) ??
    firstGroup(
      text,
      /([\u4e00-\u9fffA-Za-z0-9]{2,20}(?:工作室|美发店|美甲店|美容院|造型室|沙龙))/u,
    )
  );
}

function extractCity(text: string) {
  return (
    firstGroup(text, /城市[：:]\s*([^\n：:，,。；;]+)/u) ??
    firstGroup(text, /开在([^，,。；;\s]{2,8})/u) ??
    firstGroup(text, /(?:^|，|,|。|；|;|\s)在([^，,。；;\s]{2,8})/u) ??
    firstGroup(text, /在([\u4e00-\u9fff]{2,6}市)/u)
  );
}

function extractDistrict(text: string) {
  return firstGroup(
    text,
    /([\u4e00-\u9fff]{2,8}(?:区|县|商圈))(?=，|,|。|；|;|$)/u,
  );
}

function extractAddress(text: string) {
  return (
    firstGroup(text, /地址[：:]\s*([^\n：:]+)/u) ??
    firstGroup(text, /(?:路|街|号)[^，,。；;\n]{0,20}/u)
  );
}

function extractBooking(text: string) {
  return (
    firstGroup(text, /预约[：:]\s*([^\n：:]+)/u) ??
    firstGroup(text, /(?:微信|电话|提前一天预约)[^，,。；;\n]{0,20}/u)
  );
}

function extractProjectName(text: string) {
  const labelled = firstGroup(text, /项目名称[：:]\s*([^\n：:]+)/u);
  if (labelled) return labelled;
  const beforePrice = firstGroup(
    text,
    /([\u4e00-\u9fffA-Za-z0-9]{2,20}?)(?:套餐)?\s*(?:价格|日常价|现价|活动价|单价)/u,
  );
  if (beforePrice && !isPriceLabel(beforePrice)) {
    return /套餐$/u.test(beforePrice) || text.includes(`${beforePrice}套餐`)
      ? /套餐$/u.test(beforePrice)
        ? beforePrice
        : `${beforePrice}套餐`
      : beforePrice;
  }
  const combo = firstGroup(text, /([\u4e00-\u9fffA-Za-z0-9]{2,16}套餐)/u);
  if (combo) return combo;
  const priceAdjacent = firstGroup(
    text,
    /([\u4e00-\u9fffA-Za-z0-9]{2,20}?)\s*(?:日常价|现价|活动价|单价)?\s*(?:[¥￥]\s*)?\d+(?:\.\d{1,2})?\s*元/u,
  );
  if (priceAdjacent && !isPriceLabel(priceAdjacent)) return priceAdjacent;
  return firstGroup(text, /主打([^，,。；;\n]+)/u);
}

function extractProjectPrice(text: string) {
  const digits =
    text.match(/(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*元)/u) ??
    text.match(/(?:日常价|现价|活动价|价格)[：:]\s*(\d+(?:\.\d{1,2})?)/u);
  const numeric = digits?.[1] ?? digits?.[2];
  if (numeric) return numeric;
  const chinese = firstGroup(
    text,
    /(?:价格|日常价|现价|活动价|单价)[：:]?\s*([一二三四五六七八九两零十百千]+)/u,
  ) ?? firstGroup(text, /([一二三四五六七八九两零十百千]+)\s*(?:元|块)/u);
  if (!chinese) return undefined;
  const amount = parseChineseInteger(chinese);
  return amount === undefined ? undefined : String(amount);
}

function extractIndustry(text: string) {
  if (/美甲/u.test(text)) return 'nail';
  if (/美睫|睫毛/u.test(text)) return 'lash';
  if (/生发/u.test(text)) return 'hair_growth';
  if (/皮肤|护肤|皮肤管理/u.test(text)) return 'skin_management';
  if (/美发|理发|染发|护发|头皮/u.test(text)) return 'hair_care';
  if (/美容|综合店/u.test(text)) return 'beauty_salon';
  return undefined;
}

function firstGroup(text: string, pattern: RegExp) {
  const match = text.match(pattern)?.[1] ?? text.match(pattern)?.[0];
  const trimmed = match?.replace(/[。；;]+$/u, '').trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isPriceLabel(value: string) {
  return /^(?:日常价|现价|活动价|单价|价格)$/u.test(value);
}

function parseChineseInteger(raw: string) {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let total = 0;
  let current = 0;
  for (const character of raw) {
    if (character in digits) {
      current = digits[character]!;
      continue;
    }
    if (character === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (character === '百') {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    if (character === '千') {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    return undefined;
  }
  return total + current;
}
