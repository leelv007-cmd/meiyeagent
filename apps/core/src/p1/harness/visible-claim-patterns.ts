export type VisibleClaimPatternKind =
  | 'benefit'
  | 'offer'
  | 'price'
  | 'qualification';

export interface VisibleClaimPatternMatch {
  kind: VisibleClaimPatternKind;
  value: string;
}

const FULL_WIDTH_DIGIT_PATTERN = /[０-９]/u;
const CHINESE_OFFER_NUMBER =
  String.raw`[〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+`;
const OFFER_NUMBER = String.raw`(?:\d+(?:\.\d+)?|${CHINESE_OFFER_NUMBER})`;
const PROMOTION_CONTEXT =
  String.raw`(?:优惠|仅|只要|限时|秒杀|立减|直减|减免|券|特价|特惠|折|现价|到手价|团购价|优惠价|售价|低至|省)`;
const CURRENCY_SYMBOL = String.raw`\p{Sc}`;
const CURRENCY_LABEL =
  '(?:RMB|CNY|USD|EUR|GBP|JPY|HKD|TWD|AUD|CAD|SGD|KRW|yuan|人民币|人民幣|美元|美金|港元|港币|港幣|日元|日圆|日圓|欧元|歐元|英镑|英鎊|韩元|韓元)';
const OFFER_UNIT = '(?:元|圆|圓|[块塊](?:[钱錢])?|折|券)';
const CONCRETE_OFFER_PATTERNS = [
  new RegExp(
    String.raw`(?:${CURRENCY_SYMBOL}\s*${OFFER_NUMBER}|${OFFER_NUMBER}\s*${CURRENCY_SYMBOL}|${CURRENCY_LABEL}\s*${OFFER_NUMBER}|${OFFER_NUMBER}\s*${CURRENCY_LABEL}|${OFFER_NUMBER}\s*${OFFER_UNIT})`,
    'iu',
  ),
  new RegExp(
    String.raw`${CHINESE_OFFER_NUMBER}(?:点${CHINESE_OFFER_NUMBER})?折`,
    'u',
  ),
  new RegExp(
    String.raw`(?:价格|只要|仅需|现价|到手价|团购价|秒杀价|限时价|特价|特惠|优惠价|售价|低至|立减|直减|减免|省)[\s:：，,]*${OFFER_NUMBER}`,
    'u',
  ),
  new RegExp(String.raw`满\s*${OFFER_NUMBER}\s*减\s*${OFFER_NUMBER}`, 'u'),
  new RegExp(
    String.raw`${CHINESE_OFFER_NUMBER}\s*减\s*${CHINESE_OFFER_NUMBER}`,
    'u',
  ),
  new RegExp(
    String.raw`第\s*${OFFER_NUMBER}\s*(?:件|杯|份|位|单)\s*半价`,
    'u',
  ),
  new RegExp(String.raw`买\s*${OFFER_NUMBER}\s*送\s*${OFFER_NUMBER}`, 'u'),
];
const PROMOTION_CONTEXT_PATTERN = new RegExp(PROMOTION_CONTEXT, 'u');
const PROMOTIONAL_QUANTITY_PATTERN = new RegExp(
  String.raw`${OFFER_NUMBER}\s*(?:%|次)`,
  'u',
);
const CLAUSE_BOUNDARY_PATTERN = /[。！？!?\n；;…]+|(?<!\d)\.(?!\d)/u;
const BENIGN_QUANTITY_PATTERNS = [
  new RegExp(String.raw`(?:好评率|满意度)\s*${OFFER_NUMBER}\s*%`, 'gu'),
  new RegExp(String.raw`第\s*${OFFER_NUMBER}\s*次`, 'gu'),
  new RegExp(String.raw`每(?:天|日|周|月|年)\s*${OFFER_NUMBER}\s*次`, 'gu'),
];
const QUALIFICATION_PATTERNS = [
  /(?:国家(?:级)?(?:认证|资质)|官方认证|五星(?:级)?(?:机构|门店)|专业资质|持证(?:医师|医生|技师))/gu,
  /(?:(?:卫生部门|卫健委|国家卫健委|卫生健康委员会)[^，。！？!?\n；;]{0,12}(?:认可|批准|认证)|三甲医院合作(?:单位)?|ISO\s*\d+(?:\.\d+)?\s*(?:国际)?认证|(?:官方|权威)(?:认可|批准|认证))/giu,
];
const BENEFIT_PATTERNS = [
  /(?:到店即送|赠送|免费送|免费领取|免费体验|全年护理|终身免费)[^，。！？!?\n；;]*/gu,
];

export function containsConcreteOfferText(value: string) {
  if (FULL_WIDTH_DIGIT_PATTERN.test(value)) return true;
  const normalized = value.normalize('NFKC');
  return (
    CONCRETE_OFFER_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    containsContextualOfferQuantity(normalized)
  );
}

export function extractVisibleClaimPatternMatches(
  value: string,
): VisibleClaimPatternMatch[] {
  const normalized = value.normalize('NFKC');
  const matches: VisibleClaimPatternMatch[] = [];
  for (const pattern of QUALIFICATION_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      if (match[0]) {
        matches.push({ kind: 'qualification', value: match[0].trim() });
      }
    }
  }
  for (const pattern of BENEFIT_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      if (match[0]) {
        matches.push({ kind: 'benefit', value: match[0].trim() });
      }
    }
  }
  for (const clause of normalized.split(CLAUSE_BOUNDARY_PATTERN)) {
    const text = clause.trim();
    if (text && containsConcreteOfferText(text)) {
      matches.push({ kind: 'offer', value: text });
    }
  }
  return matches;
}

function containsContextualOfferQuantity(value: string) {
  const withoutBenignQuantities = BENIGN_QUANTITY_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, ''),
    value,
  );
  return withoutBenignQuantities
    .split(CLAUSE_BOUNDARY_PATTERN)
    .some(
      (clause) =>
        PROMOTION_CONTEXT_PATTERN.test(clause) &&
        PROMOTIONAL_QUANTITY_PATTERN.test(clause),
    );
}
