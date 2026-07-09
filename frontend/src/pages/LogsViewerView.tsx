import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { apiLogs } from '@/data/mockData';

export function LogsViewerView() {
  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Nhật ký API"
        description="Theo dõi yêu cầu API, route family, model, latency, status, gateway key alias và upstream target."
        warning={<span>Beta: dữ liệu hiện là mock data cho đến khi streaming log API được triển khai.</span>}
      />
      <ApiLogsTable rows={apiLogs} />
    </div>
  );
}
