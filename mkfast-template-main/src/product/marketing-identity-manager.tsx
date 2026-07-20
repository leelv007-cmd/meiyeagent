import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getLocale } from '@/lib/locale';
import { commandP1, queryP1 } from '@/p1/client';
import type { MarketingIdentityAsset } from '@meiye/contracts';

import {
  answerMarketingIdentityQuestion,
  marketingIdentityFlowState,
  marketingIdentityQuestions,
  marketingIdentityRegistrationFromDraft,
  type MarketingIdentityDraft,
  type MarketingIdentityQuestionId,
} from './marketing-identity-form';

const COPY = {
  zh: {
    title: '表达身份',
    description:
      '记下品牌或个人 IP 怎么说话、什么不能说。撤回、离职或换运营会生成新版本，避免误用。',
    brand: '品牌',
    person: '个人 IP',
    displayName: '展示名称',
    owner: '归属人/主体',
    claimOrRole: '品牌主张/真实职业',
    boundaries: '专业边界（换行或逗号分隔）',
    samples: '表达样例（换行或逗号分隔）',
    forbiddenClaimsPlaceholder:
      '例如：不承诺「7 天见效」\n例如：不代言未经验证的产品',
    visualPrinciplesPlaceholder:
      '例如：自然肤色，不用夸张前后对比\n例如：干净留白，少用荧光色',
    seriesAnchorsPlaceholder: '例如：每周护肤答疑\n例如：到店护理日记',
    sourceRef: '授权证明或内部备注（可填编号）',
    yes: '是，已确认',
    no: '否，尚未授权',
    next: '继续',
    skip: '暂时跳过',
    answeredTitle: '本次已确认',
    answeredSkipped: '暂未填写',
    editAnswer: '点击修改',
    previewTitle: '确认后保存为表达身份',
    previewDescription:
      '保存后，之后生成的内容会按这里记下的说法和边界来用。',
    questionKind: '这次要登记品牌身份，还是个人 IP？',
    questionDisplayName: '希望在内容里怎么称呼这个身份？',
    questionOwner: '这个身份归属于谁？',
    questionBrandClaim: '这个品牌最核心的主张是什么？',
    questionPersonRole: '这个人的真实职业或专业角色是什么？',
    questionBoundaries: '哪些话或做法绝对不能碰？',
    questionSamples: '给一两句最能代表这个身份的表达样例。',
    questionSourceRef: '授权证明或内部备注是什么？（可填编号）',
    questionForbiddenClaims: '有哪些话这个品牌坚决不说？',
    questionVisualPrinciples: '画面希望长期保持什么感觉？',
    questionSeriesAnchors: '有哪些栏目值得长期连续做？',
    questionPortrait: '是否已经获得这个人的肖像使用授权？',
    questionVoice: '是否已经获得这个人的声音使用授权？',
    register: '登记身份',
    registering: '登记中…',
    empty: '尚未登记身份。没有活动身份时，任务只能回退为门店官方中性表达。',
    revoke: '撤回',
    depart: '离职',
    operatorChange: '换运营',
    statusActive: '生效中',
    statusRevoked: '已撤回',
    statusDeparted: '已离职',
    statusOperatorChanged: '已换运营',
    failed: '身份操作未完成，请检查必填项或刷新后重试。',
  },
  en: {
    title: 'Expression identity',
    description:
      'Note how the brand or personal IP speaks and what it must never say. Withdrawal, departure, or operator change creates a new version so old wording is not reused by mistake.',
    brand: 'Brand',
    person: 'Personal IP',
    displayName: 'Display name',
    owner: 'Owner',
    claimOrRole: 'Brand claim / real role',
    boundaries: 'Professional boundaries',
    samples: 'Expression samples',
    forbiddenClaimsPlaceholder:
      'Example: Never promise results in seven days\nExample: Never endorse unverified products',
    visualPrinciplesPlaceholder:
      'Example: Natural skin tones without exaggerated comparisons\nExample: Clean layouts with plenty of space',
    seriesAnchorsPlaceholder:
      'Example: Weekly skincare Q&A\nExample: In-store treatment diary',
    sourceRef: 'Proof of authorization or internal note (ID optional)',
    yes: 'Yes, confirmed',
    no: 'No, not authorized',
    next: 'Continue',
    skip: 'Skip for now',
    answeredTitle: 'Confirmed for this identity',
    answeredSkipped: 'Not provided yet',
    editAnswer: 'Select to edit',
    previewTitle: 'Confirm and save this expression identity',
    previewDescription:
      'After saving, new content will follow the voice and boundaries you noted here.',
    questionKind: 'Are you registering a brand or a personal identity?',
    questionDisplayName: 'How should this identity appear in content?',
    questionOwner: 'Who owns this identity?',
    questionBrandClaim: 'What is the brand’s central claim?',
    questionPersonRole: 'What is this person’s real professional role?',
    questionBoundaries: 'What words or practices must never be used?',
    questionSamples: 'Share one or two representative expression samples.',
    questionSourceRef:
      'Any authorization proof or internal note? (ID optional)',
    questionForbiddenClaims: 'What must this brand never claim?',
    questionVisualPrinciples: 'How should the visuals consistently feel?',
    questionSeriesAnchors: 'Which recurring series should continue?',
    questionPortrait: 'Is this person’s portrait authorized for use?',
    questionVoice: 'Is this person’s voice authorized for use?',
    register: 'Register identity',
    registering: 'Registering…',
    empty:
      'No identities yet. Tasks fall back to the store’s neutral official voice.',
    revoke: 'Revoke',
    depart: 'Departed',
    operatorChange: 'Operator changed',
    statusActive: 'Active',
    statusRevoked: 'Revoked',
    statusDeparted: 'Departed',
    statusOperatorChanged: 'Operator changed',
    failed:
      'Identity action failed. Check required fields or refresh and retry.',
  },
} as const;

function identityStatusLabel(
  status: MarketingIdentityAsset['status'],
  copy: (typeof COPY)[keyof typeof COPY]
) {
  const labels: Record<MarketingIdentityAsset['status'], string> = {
    active: copy.statusActive,
    departed: copy.statusDeparted,
    operator_changed: copy.statusOperatorChanged,
    revoked: copy.statusRevoked,
  };
  return labels[status];
}

export function MarketingIdentityManager() {
  const copy = COPY[getLocale()];
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MarketingIdentityDraft>({});
  const [activeQuestionId, setActiveQuestionId] =
    useState<MarketingIdentityQuestionId | null>('kind');
  const [error, setError] = useState(false);
  const initialPanelRef = useRef(true);
  const queryKey = ['marketing-identities'] as const;
  const identities = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      queryP1<MarketingIdentityAsset[]>(
        'marketing-identity',
        {
          action: 'marketing_identities',
          payload: { includeInactive: true },
        },
        signal
      ),
  });
  const command = useMutation({
    mutationFn: (input: { action: string; payload: Record<string, unknown> }) =>
      commandP1('marketing-identity', input),
    onSuccess: async () => {
      setError(false);
      await queryClient.invalidateQueries({ queryKey });
      setDraft({});
      setActiveQuestionId('kind');
    },
    onError: () => setError(true),
  });
  const flow = marketingIdentityFlowState(draft);
  const questions = marketingIdentityQuestions(draft);
  const currentPanelId = activeQuestionId
    ? identityQuestionRegionId(activeQuestionId)
    : flow.readyForPreview
      ? 'marketing-identity-preview-region'
      : null;
  const liveMessage = activeQuestionId
    ? questionLabel(activeQuestionId, draft, copy)
    : flow.readyForPreview
      ? copy.previewTitle
      : '';

  useEffect(() => {
    if (initialPanelRef.current) {
      initialPanelRef.current = false;
      return;
    }
    if (currentPanelId) {
      document.getElementById(currentPanelId)?.focus();
    }
  }, [currentPanelId]);

  function answerQuestion(
    questionId: MarketingIdentityQuestionId,
    value: boolean | string,
    advance: boolean
  ) {
    try {
      const nextDraft = answerMarketingIdentityQuestion(
        draft,
        questionId,
        value
      );
      setDraft(nextDraft);
      setError(false);
      if (advance) {
        setActiveQuestionId(
          marketingIdentityFlowState(nextDraft).currentQuestionId
        );
      }
    } catch {
      setError(true);
    }
  }

  function register() {
    try {
      command.mutate({
        action: 'register_marketing_identity',
        payload: marketingIdentityRegistrationFromDraft(draft),
      });
    } catch {
      setError(true);
    }
  }

  return (
    <section
      aria-labelledby="marketing-identity-manager-title"
      className="space-y-4 rounded-xl border bg-surface-2 p-4"
    >
      <div>
        <h3 className="font-medium" id="marketing-identity-manager-title">
          {copy.title}
        </h3>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {flow.answeredQuestionIds.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{copy.answeredTitle}</p>
          <div className="flex flex-wrap gap-2">
            {flow.answeredQuestionIds.map((questionId) => (
              <Button
                aria-label={`${questionLabel(questionId, draft, copy)} · ${copy.editAnswer}`}
                aria-pressed={activeQuestionId === questionId}
                key={questionId}
                onClick={() => setActiveQuestionId(questionId)}
                size="sm"
                type="button"
                variant={
                  activeQuestionId === questionId ? 'secondary' : 'outline'
                }
              >
                {questionLabel(questionId, draft, copy)} ·{' '}
                {answerSummary(questionId, draft, copy)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {activeQuestionId ? (
        <IdentityQuestionCard
          copy={copy}
          draft={draft}
          onAnswer={(value, advance = false) =>
            answerQuestion(activeQuestionId, value, advance)
          }
          questionId={activeQuestionId}
        />
      ) : flow.readyForPreview ? (
        <section
          aria-labelledby="marketing-identity-preview-title"
          className="meiye-porcelain space-y-4 rounded-2xl p-4"
          id="marketing-identity-preview-region"
          tabIndex={-1}
        >
          <div>
            <h4 className="font-medium" id="marketing-identity-preview-title">
              {copy.previewTitle}
            </h4>
            <p className="text-sm text-muted-foreground">
              {copy.previewDescription}
            </p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {questions.map((questionId) => (
              <div className="space-y-1" key={questionId}>
                <dt className="text-muted-foreground">
                  {questionLabel(questionId, draft, copy)}
                </dt>
                <dd>{answerSummary(questionId, draft, copy)}</dd>
              </div>
            ))}
          </dl>
          <Button disabled={command.isPending} onClick={register} type="button">
            {command.isPending ? copy.registering : copy.register}
          </Button>
        </section>
      ) : null}
      {error ? <p className="text-sm text-destructive">{copy.failed}</p> : null}
      <div className="space-y-2">
        {(identities.data ?? []).map((identity) => (
          <article
            className="rounded-md border bg-background p-3"
            key={identity.identityId}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>{identity.displayName}</strong>
              <Badge variant="outline">
                {identity.kind === 'brand' ? copy.brand : copy.person}
              </Badge>
              <Badge
                variant={identity.status === 'active' ? 'secondary' : 'outline'}
              >
                {identityStatusLabel(identity.status, copy)}
              </Badge>
              {identity.status === 'active' ? (
                <div className="ml-auto flex flex-wrap gap-2">
                  {(
                    [
                      ['revoke', copy.revoke],
                      ['depart', copy.depart],
                      ['operator_change', copy.operatorChange],
                    ] as const
                  ).map(([transition, label]) => (
                    <Button
                      disabled={command.isPending}
                      key={transition}
                      onClick={() =>
                        command.mutate({
                          action: 'transition_marketing_identity',
                          payload: {
                            identityId: identity.identityId,
                            expectedVersion: identity.version,
                            transition,
                            reason: label,
                          },
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {identities.isSuccess && identities.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        ) : null}
      </div>
    </section>
  );
}

function IdentityQuestionCard({
  copy,
  draft,
  onAnswer,
  questionId,
}: {
  copy: (typeof COPY)[keyof typeof COPY];
  draft: MarketingIdentityDraft;
  onAnswer: (value: boolean | string, advance?: boolean) => void;
  questionId: MarketingIdentityQuestionId;
}) {
  const question = questionLabel(questionId, draft, copy);
  const value = draft[questionId];
  const headingId = identityQuestionHeadingId(questionId);
  const regionId = identityQuestionRegionId(questionId);
  if (questionId === 'kind') {
    return (
      <section
        aria-labelledby={headingId}
        className="meiye-porcelain space-y-3 rounded-2xl p-4"
        id={regionId}
        tabIndex={-1}
      >
        <h4 className="font-medium" id={headingId}>
          {question}
        </h4>
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{question}</legend>
          <Button
            aria-pressed={draft.kind === 'brand'}
            onClick={() => onAnswer('brand', true)}
            type="button"
            variant={draft.kind === 'brand' ? 'secondary' : 'outline'}
          >
            {copy.brand}
          </Button>
          <Button
            aria-pressed={draft.kind === 'person'}
            onClick={() => onAnswer('person', true)}
            type="button"
            variant={draft.kind === 'person' ? 'secondary' : 'outline'}
          >
            {copy.person}
          </Button>
        </fieldset>
      </section>
    );
  }
  if (questionId === 'portraitAuthorized' || questionId === 'voiceAuthorized') {
    return (
      <section
        aria-labelledby={headingId}
        className="meiye-porcelain space-y-3 rounded-2xl p-4"
        id={regionId}
        tabIndex={-1}
      >
        <h4 className="font-medium" id={headingId}>
          {question}
        </h4>
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{question}</legend>
          <Button
            aria-pressed={value === true}
            onClick={() => onAnswer(true, true)}
            type="button"
            variant={value === true ? 'secondary' : 'outline'}
          >
            {copy.yes}
          </Button>
          <Button
            aria-pressed={value === false}
            onClick={() => onAnswer(false, true)}
            type="button"
            variant={value === false ? 'secondary' : 'outline'}
          >
            {copy.no}
          </Button>
        </fieldset>
      </section>
    );
  }
  const optional = isOptionalQuestion(questionId);
  const inputId = `marketing-identity-question-${questionId}`;
  const textValue = typeof value === 'string' ? value : '';
  const multiline = isMultilineQuestion(questionId);
  const placeholder = questionPlaceholder(questionId, copy);
  return (
    <section
      aria-labelledby={headingId}
      className="meiye-porcelain space-y-3 rounded-2xl p-4"
      id={regionId}
      tabIndex={-1}
    >
      <h4 className="font-medium" id={headingId}>
        {question}
      </h4>
      {multiline ? (
        <Textarea
          aria-labelledby={headingId}
          id={inputId}
          onChange={(event) => onAnswer(event.currentTarget.value)}
          placeholder={placeholder}
          value={textValue}
        />
      ) : (
        <Input
          aria-labelledby={headingId}
          id={inputId}
          onChange={(event) => onAnswer(event.currentTarget.value)}
          placeholder={placeholder}
          value={textValue}
        />
      )}
      <Button
        disabled={!optional && textValue.trim().length === 0}
        onClick={() => onAnswer(textValue, true)}
        type="button"
      >
        {optional && textValue.trim().length === 0 ? copy.skip : copy.next}
      </Button>
    </section>
  );
}

function questionLabel(
  questionId: MarketingIdentityQuestionId,
  draft: MarketingIdentityDraft,
  copy: (typeof COPY)[keyof typeof COPY]
) {
  const labels: Record<MarketingIdentityQuestionId, string> = {
    kind: copy.questionKind,
    displayName: copy.questionDisplayName,
    owner: copy.questionOwner,
    primaryClaimOrRole:
      draft.kind === 'person'
        ? copy.questionPersonRole
        : copy.questionBrandClaim,
    professionalBoundaries: copy.questionBoundaries,
    expressionSamples: copy.questionSamples,
    sourceRef: copy.questionSourceRef,
    forbiddenClaims: copy.questionForbiddenClaims,
    visualPrinciples: copy.questionVisualPrinciples,
    seriesAnchors: copy.questionSeriesAnchors,
    portraitAuthorized: copy.questionPortrait,
    voiceAuthorized: copy.questionVoice,
  };
  return labels[questionId];
}

function identityQuestionHeadingId(questionId: MarketingIdentityQuestionId) {
  return `marketing-identity-question-heading-${questionId}`;
}

function identityQuestionRegionId(questionId: MarketingIdentityQuestionId) {
  return `marketing-identity-question-region-${questionId}`;
}

function questionPlaceholder(
  questionId: MarketingIdentityQuestionId,
  copy: (typeof COPY)[keyof typeof COPY]
) {
  const placeholders: Partial<Record<MarketingIdentityQuestionId, string>> = {
    displayName: copy.displayName,
    owner: copy.owner,
    primaryClaimOrRole: copy.claimOrRole,
    professionalBoundaries: copy.boundaries,
    expressionSamples: copy.samples,
    sourceRef: copy.sourceRef,
    forbiddenClaims: copy.forbiddenClaimsPlaceholder,
    visualPrinciples: copy.visualPrinciplesPlaceholder,
    seriesAnchors: copy.seriesAnchorsPlaceholder,
  };
  return placeholders[questionId];
}

function answerSummary(
  questionId: MarketingIdentityQuestionId,
  draft: MarketingIdentityDraft,
  copy: (typeof COPY)[keyof typeof COPY]
) {
  const value = draft[questionId];
  if (questionId === 'kind') {
    return draft.kind === 'person' ? copy.person : copy.brand;
  }
  if (typeof value === 'boolean') return value ? copy.yes : copy.no;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return copy.answeredSkipped;
  }
  return value.length > 28 ? `${value.slice(0, 28)}…` : value;
}

function isOptionalQuestion(questionId: MarketingIdentityQuestionId) {
  return (
    questionId === 'forbiddenClaims' ||
    questionId === 'visualPrinciples' ||
    questionId === 'seriesAnchors'
  );
}

function isMultilineQuestion(questionId: MarketingIdentityQuestionId) {
  return (
    questionId === 'professionalBoundaries' ||
    questionId === 'expressionSamples' ||
    questionId === 'forbiddenClaims' ||
    questionId === 'visualPrinciples' ||
    questionId === 'seriesAnchors'
  );
}
