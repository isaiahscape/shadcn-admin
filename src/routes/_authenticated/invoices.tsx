import { createFileRoute } from '@tanstack/react-router'
import { InvoicesView } from '@/features/invoices'

export const Route = createFileRoute('/_authenticated/invoices')({
  component: InvoicesView,
})