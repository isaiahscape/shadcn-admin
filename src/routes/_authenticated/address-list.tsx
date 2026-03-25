import { createFileRoute } from '@tanstack/react-router'
import { AddressListView } from '@/features/address-list'

export const Route = createFileRoute('/_authenticated/address-list')({
  component: AddressListView,
})