import { createFileRoute } from '@tanstack/react-router'
import { DhcpLeasesView } from '@/features/dhcp-leases'

export const Route = createFileRoute('/_authenticated/dhcp-leases')({
  component: DhcpLeasesView,
})