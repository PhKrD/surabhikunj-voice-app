import { NavLink } from 'react-router-dom'
import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tap } from '@/lib/haptics'
import useOrgStore from '@/store/orgStore'
import { pickBottomItems } from '@/lib/navPriority'
import DynamicIcon from '@/components/ui/DynamicIcon'

function Tab({ to, iconName, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => tap()}
      className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 h-full"
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'flex items-center justify-center w-14 h-8 rounded-full transition-colors duration-150',
              isActive ? 'bg-[var(--color-primary-soft)]' : '',
            )}
          >
            <DynamicIcon
              name={iconName}
              className={cn('w-[22px] h-[22px] transition-colors', isActive ? 'text-[var(--color-primary)]' : 'text-muted-token')}
              strokeWidth={isActive ? 2.25 : 1.9}
              aria-hidden="true"
            />
          </span>
          <span className={cn('text-[0.6875rem] leading-none truncate max-w-full px-1', isActive ? 'font-semibold text-primary-token' : 'font-medium text-muted-token')}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  )
}

/** Phone-only tab bar: Home, up to three role-relevant modules, More. */
export default function BottomNav({ onMore, moreOpen }) {
  const nav = useOrgStore((s) => s.nav)
  const isAdmin = useOrgStore((s) => s.hasAnyPermission(['members.manage', 'reports.view']))
  const items = pickBottomItems(nav, isAdmin)

  return (
    <nav
      aria-label="Main"
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-[var(--surface)]/95 backdrop-blur-md border-t border-[var(--border-color)] pb-safe"
    >
      <div className="flex items-stretch h-[var(--bottom-nav-h)] max-w-xl mx-auto px-1">
        {items.map((item) => (
          <Tab
            key={item.key}
            to={item.route}
            end={item.route === '/'}
            iconName={item.key === 'dashboard' ? 'Home' : item.icon}
            label={item.key === 'dashboard' ? 'Home' : item.label || item.key}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            tap()
            onMore()
          }}
          aria-expanded={moreOpen}
          className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 h-full"
        >
          <span className={cn('flex items-center justify-center w-14 h-8 rounded-full', moreOpen && 'bg-[var(--color-primary-soft)]')}>
            <LayoutGrid className={cn('w-[22px] h-[22px]', moreOpen ? 'text-[var(--color-primary)]' : 'text-muted-token')} aria-hidden="true" />
          </span>
          <span className={cn('text-[0.6875rem] leading-none', moreOpen ? 'font-semibold text-primary-token' : 'font-medium text-muted-token')}>More</span>
        </button>
      </div>
    </nav>
  )
}
