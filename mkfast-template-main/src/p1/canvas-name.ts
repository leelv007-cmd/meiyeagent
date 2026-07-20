import {
  DEFAULT_CANVAS_TEMPLATE_NAME,
  DEFAULT_CANVAS_WORK_NAME,
  OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX,
  OFFICIAL_CANVAS_WORK_NAME_PREFIX,
} from '@meiye/contracts';
import {
  canvas_work_template_name,
  creation_shelf_blank_canvas_name,
  creation_shelf_canvas_name,
  p1_template_family_before_after,
  p1_template_family_package_explainer,
  p1_template_family_price_card,
  p1_template_family_review_card,
  p1_template_family_shooting_checklist,
  p1_template_family_social_cover,
  p1_template_family_store_intro,
} from '@/locale/paraglide/messages';

const LEGACY_BLANK_WORK_NAMES = new Set(['Blank visual post', '空白图文作品']);
const LEGACY_BLANK_TEMPLATE_NAMES = new Set([
  'Blank visual post template',
  '空白图文作品模板',
]);

const OFFICIAL_TEMPLATE_FAMILY_LABEL: Record<string, () => string> = {
  before_after: p1_template_family_before_after,
  package_explainer: p1_template_family_package_explainer,
  price_card: p1_template_family_price_card,
  review_card: p1_template_family_review_card,
  shooting_checklist: p1_template_family_shooting_checklist,
  social_cover: p1_template_family_social_cover,
  store_intro: p1_template_family_store_intro,
};

export function officialTemplateFamilyName(family: string): string | undefined {
  return OFFICIAL_TEMPLATE_FAMILY_LABEL[family]?.();
}

export function canvasName(name: string): string {
  if (name === DEFAULT_CANVAS_WORK_NAME || LEGACY_BLANK_WORK_NAMES.has(name)) {
    return creation_shelf_blank_canvas_name();
  }
  if (
    name === DEFAULT_CANVAS_TEMPLATE_NAME ||
    LEGACY_BLANK_TEMPLATE_NAMES.has(name)
  ) {
    return canvas_work_template_name({
      name: creation_shelf_blank_canvas_name(),
    });
  }
  if (name.startsWith(OFFICIAL_CANVAS_WORK_NAME_PREFIX)) {
    const familyName = officialTemplateFamilyName(
      name.slice(OFFICIAL_CANVAS_WORK_NAME_PREFIX.length)
    );
    if (familyName) {
      return creation_shelf_canvas_name({ name: familyName });
    }
  }
  if (name.startsWith(OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX)) {
    const familyName = officialTemplateFamilyName(
      name.slice(OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX.length)
    );
    if (familyName) {
      return canvas_work_template_name({
        name: creation_shelf_canvas_name({ name: familyName }),
      });
    }
  }
  return name;
}
