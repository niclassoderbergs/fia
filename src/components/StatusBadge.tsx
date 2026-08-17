import { STATUS_LABEL } from '@/lib/format';
import type { RunStatus } from '@/lib/types';

const CLASS_BY_STATUS: Record<RunStatus, string> = {
  success: 'badge-ok',
  blocked: 'badge-warn',
  failed: 'badge-danger',
};

export default function StatusBadge({ status, dryRun }: { status: RunStatus; dryRun?: boolean }) {
  return (
    <>
      <span className={`badge ${CLASS_BY_STATUS[status]}`}>{STATUS_LABEL[status] ?? status}</span>
      {dryRun ? <span className="badge badge-neutral"> torrkörning</span> : null}
    </>
  );
}
