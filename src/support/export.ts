export interface ExportRequest {
  destination: string;
  limit: number;
}

export function exportCustomers(request: ExportRequest): string {
  return `exported ${request.limit} customers to ${request.destination}`;
}
