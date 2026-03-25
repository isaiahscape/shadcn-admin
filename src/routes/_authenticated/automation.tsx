import { createFileRoute } from '@tanstack/react-router'
import { AutoDisableView } from '@/features/auto-disable'

export const Route = createFileRoute('/_authenticated/automation')({
  component: AutoDisableView,
})