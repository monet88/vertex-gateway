import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface GatewayKeysViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function GatewayKeysView({ adminData }: GatewayKeysViewProps) {
  return (
    <div className="space-y-6">
      <StitchPageHeader
        eyebrow="Client -> Gateway"
        title="Quản lý Gateway Key"
        description="Gateway key dùng cho client gọi vào gateway. Đây không phải Google Cloud API key."
        actions={adminData.mutable ? <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} /> : null}
      />

      {adminData.error ? <AdminError message={adminData.error} onRetry={() => adminData.refetch()} /> : null}

      <StitchPanel title="Danh sách key" description="Key preview luôn được mask; thao tác thu hồi và xóa chỉ bật trong file-store mode.">
        {adminData.loading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : (
          <GatewayKeysTable
            rows={adminData.gatewayKeys}
            onRevoke={(id) => adminData.revokeKey(id)}
            onDelete={(id) => adminData.deleteKey(id)}
            mutable={adminData.mutable}
          />
        )}
      </StitchPanel>
    </div>
  );
}
