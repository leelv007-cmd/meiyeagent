import { IconCheck, IconChevronDown } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import {
  content_module_label_before_after,
  content_module_label_package_explainer,
  content_module_label_price_card,
  content_module_label_review_card,
  content_module_label_shooting_checklist,
  content_module_label_social_cover,
  content_module_label_store_intro,
  content_module_material_requirement,
  content_module_persistence_note,
  content_module_requirement_before_after,
  content_module_requirement_package_explainer,
  content_module_requirement_price_card,
  content_module_requirement_review_card,
  content_module_requirement_shooting_checklist,
  content_module_requirement_social_cover,
  content_module_requirement_store_intro,
  content_module_select_legend,
  content_module_structure_title,
  content_module_title,
  content_suite_locked_expand,
  content_suite_locked_summary,
  content_suite_locked_summary_preset,
} from '@/locale/paraglide/messages';
import {
  creativeContentModuleIds,
  type CreativeContentModuleId,
} from '@meiye/contracts';

export const CONTENT_MODULE_LABELS = {
  get before_after() {
    return content_module_label_before_after();
  },
  get package_explainer() {
    return content_module_label_package_explainer();
  },
  get price_card() {
    return content_module_label_price_card();
  },
  get review_card() {
    return content_module_label_review_card();
  },
  get shooting_checklist() {
    return content_module_label_shooting_checklist();
  },
  get social_cover() {
    return content_module_label_social_cover();
  },
  get store_intro() {
    return content_module_label_store_intro();
  },
} satisfies Record<CreativeContentModuleId, string>;

export const CONTENT_MODULE_REQUIREMENTS = {
  get before_after() {
    return content_module_requirement_before_after();
  },
  get package_explainer() {
    return content_module_requirement_package_explainer();
  },
  get price_card() {
    return content_module_requirement_price_card();
  },
  get review_card() {
    return content_module_requirement_review_card();
  },
  get shooting_checklist() {
    return content_module_requirement_shooting_checklist();
  },
  get social_cover() {
    return content_module_requirement_social_cover();
  },
  get store_intro() {
    return content_module_requirement_store_intro();
  },
} satisfies Record<CreativeContentModuleId, string>;

export function ContentModuleBuilder({
  availableModules,
  disabled,
  onChange,
  presetName,
  selectedModules,
}: {
  availableModules: CreativeContentModuleId[];
  disabled: boolean;
  onChange: (modules: CreativeContentModuleId[]) => void;
  presetName?: string;
  selectedModules: CreativeContentModuleId[];
}) {
  const available = creativeContentModuleIds.filter((moduleId) =>
    availableModules.includes(moduleId)
  );
  const locked = creativeContentModuleIds.filter(
    (moduleId) => !availableModules.includes(moduleId)
  );
  return (
    <section
      aria-labelledby="content-suite-title"
      className="min-w-0 space-y-3"
    >
      <h3
        className="text-sm font-medium text-foreground"
        id="content-suite-title"
      >
        {content_module_title()}
      </h3>
      <fieldset className="min-w-0">
        <legend className="sr-only">{content_module_select_legend()}</legend>
        <div className="flex flex-wrap gap-2">
          {available.map((moduleId) => {
            const checked = selectedModules.includes(moduleId);
            return (
              <Button
                aria-pressed={checked}
                className="rounded-full"
                disabled={disabled || (checked && selectedModules.length === 1)}
                key={moduleId}
                onClick={() => {
                  if (checked) {
                    if (selectedModules.length > 1) {
                      onChange(
                        selectedModules.filter(
                          (candidate) => candidate !== moduleId
                        )
                      );
                    }
                  } else {
                    onChange([...selectedModules, moduleId]);
                  }
                }}
                size="sm"
                type="button"
                variant={checked ? 'secondary' : 'outline'}
              >
                {checked ? <IconCheck aria-hidden="true" /> : null}
                {CONTENT_MODULE_LABELS[moduleId]}
              </Button>
            );
          })}
        </div>
      </fieldset>
      {selectedModules.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {content_module_structure_title()}：
          {selectedModules
            .map((moduleId) => CONTENT_MODULE_LABELS[moduleId])
            .join(' → ')}
        </p>
      ) : null}
      {locked.length > 0 ? (
        <details className="group min-w-0">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
            {presetName
              ? content_suite_locked_summary_preset({
                  count: locked.length,
                  preset: presetName,
                })
              : content_suite_locked_summary({ count: locked.length })}
            <span className="sr-only">{content_suite_locked_expand()}</span>
            <IconChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <ul className="mt-2 space-y-1.5">
            {locked.map((moduleId) => (
              <li className="text-xs text-muted-foreground" key={moduleId}>
                <span className="font-medium">
                  {CONTENT_MODULE_LABELS[moduleId]}
                </span>
                {' · '}
                {content_module_material_requirement({
                  requirement: CONTENT_MODULE_REQUIREMENTS[moduleId],
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {content_module_persistence_note()}
      </p>
    </section>
  );
}
