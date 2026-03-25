import { createFileRoute } from '@tanstack/react-router'
import { ClientsView } from '@/features/clients'

export const Route = createFileRoute('/_authenticated/clients')({
  component: ClientsView,
})