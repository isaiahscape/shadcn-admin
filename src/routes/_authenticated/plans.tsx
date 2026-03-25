import { createFileRoute } from '@tanstack/react-router'
import { PlansView } from '@/features/plans'

export const Route = createFileRoute('/_authenticated/plans')({
  component: PlansView,
})
