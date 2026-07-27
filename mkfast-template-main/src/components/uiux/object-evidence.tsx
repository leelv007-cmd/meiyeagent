import {
  object_evidence_kind,
  object_evidence_kind_asset,
  object_evidence_kind_content,
  object_evidence_kind_job,
  object_evidence_kind_session,
  object_evidence_kind_task,
  object_evidence_kind_work,
  object_evidence_source,
  object_evidence_source_canvas,
} from '@/locale/paraglide/messages';
import { ProductIcon } from './product-icon';
import { IconFingerprint } from '@tabler/icons-react';

type ObjectEvidenceKind =
  | 'Task'
  | 'Work'
  | 'Job'
  | 'Asset'
  | 'Content'
  | 'Session';

interface ObjectEvidenceProps {
  id: string;
  kind: ObjectEvidenceKind;
  source?: string;
}

const KIND_LABEL: Record<ObjectEvidenceKind, () => string> = {
  Asset: object_evidence_kind_asset,
  Content: object_evidence_kind_content,
  Job: object_evidence_kind_job,
  Session: object_evidence_kind_session,
  Task: object_evidence_kind_task,
  Work: object_evidence_kind_work,
};

function sourceLabel(source: string) {
  return source === 'Canvas' ? object_evidence_source_canvas() : source;
}

export function ObjectEvidence({ kind, source }: ObjectEvidenceProps) {
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
        <dt className="text-sm font-medium text-foreground">
          {object_evidence_kind()}
        </dt>
        <dd className="mt-1 flex items-center gap-2 text-sm/6 text-muted-foreground sm:col-span-2 sm:mt-0">
          <ProductIcon
            className="text-muted-foreground"
            icon={IconFingerprint}
            size={16}
          />
          <span>{KIND_LABEL[kind]()}</span>
        </dd>
      </div>
      {source ? (
        <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm font-medium text-foreground">
            {object_evidence_source()}
          </dt>
          <dd className="mt-1 min-w-0 truncate text-sm/6 text-muted-foreground sm:col-span-2 sm:mt-0">
            {sourceLabel(source)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
