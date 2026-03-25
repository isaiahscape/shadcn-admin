import { createFileRoute } from '@tanstack/react-router'
import { MikrotikMainDashboard } from '@/features/mkt-dashboard'

export const Route = createFileRoute('/_authenticated/mkt-dashboard')({
  component: MikrotikMainDashboard,
})