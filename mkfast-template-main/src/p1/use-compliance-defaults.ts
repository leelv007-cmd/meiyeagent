import { useQuery } from '@tanstack/react-query';
import { queryP1 } from './client';
import { p1QueryKeys } from './query-keys';

export interface ComplianceDefaults {
  'compliance.aigc_label.default': boolean;
  'compliance.regulated_mode.default': boolean;
  'compliance.watermark.default': boolean;
}

export function useComplianceDefaults() {
  return useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'config_defaults'),
    queryFn: ({ signal }) =>
      queryP1<ComplianceDefaults>(
        'admin-config',
        { action: 'config_defaults', payload: {} },
        signal
      ),
  });
}
