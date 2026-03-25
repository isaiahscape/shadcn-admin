import {
  Construction,
  LayoutDashboard,
  Monitor,
  Bug,
  ListTodo,
  FileX,
  HelpCircle,
  Lock,
  Bell,
  Package,
  Palette,
  ServerOff,
  Settings,
  Wrench,
  UserCog,
  UserX,
  Users,
  MessagesSquare,
  ShieldCheck,
  AudioWaveform,
  Command,
  GalleryVerticalEnd,
  BarChart2,
  FileText,
  Server,
  Shield,
  Clock,
} from 'lucide-react'
import { ClerkLogo } from '@/assets/clerk-logo'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Mikrotik',
    email: 'appadmin',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Mikrotik IPoE Manager',
      logo: Command,
      plan: 'Made with ShadcnUI',
    },
  ],
  navGroups: [
    {
      title: 'MikroTik Management',
      items: [
        {
          title: 'Dashboard',
          url: '/mkt-dashboard',
          icon: BarChart2,
        },
        {
          title: 'Client Database',
          url: '/clients',
          icon: Users,
        },
        {
          title: 'Invoices',
          url: '/invoices',
          icon: FileText,
        },
        {
          title: 'DHCP Leases',
          url: '/dhcp-leases',
          icon: Server,
        },
        {
          title: 'Plans & Pricing',
          url: '/plans',
          icon: Package,
        },
        {
          title: 'Address List',
          url: '/address-list',
          icon: Shield,
        },
        {
          title: 'Automation',
          url: '/automation',
          icon: Clock,
        },
      ],
    },
    {
      title: 'Other',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          items: [
            {
              title: 'Profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'Account',
              url: '/settings/account',
              icon: Wrench,
            },
            {
              title: 'Appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: 'Notifications',
              url: '/settings/notifications',
              icon: Bell,
            },
            {
              title: 'Display',
              url: '/settings/display',
              icon: Monitor,
            },
          ],
        },
        {
          title: 'Help Center',
          url: '/help-center',
          icon: HelpCircle,
        },
      ],
    },
  ],
}
