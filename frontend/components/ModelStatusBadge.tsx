import { AlertCircle, CheckCircle2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelAvailabilityLevel = 'active' | 'partial' | 'inactive'

interface ModelStatusBadgeProps {
  level: ModelAvailabilityLevel
  label: string
  summary: string
  onClick?: () => void
}

const badgeStyles: Record<ModelAvailabilityLevel, string> = {
  active: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/18',
  partial: 'border-amber-500/40 bg-amber-500/12 text-amber-300 hover:bg-amber-500/18',
  inactive: 'border-red-500/40 bg-red-500/12 text-red-300 hover:bg-red-500/18',
}

function BadgeIcon({ level }: { level: ModelAvailabilityLevel }) {
  if (level === 'active') {
    return <CheckCircle2 className="h-3.5 w-3.5" />
  }
  if (level === 'partial') {
    return <TriangleAlert className="h-3.5 w-3.5" />
  }
  return <AlertCircle className="h-3.5 w-3.5" />
}

export function ModelStatusBadge({ level, label, summary, onClick }: ModelStatusBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={summary}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors',
        badgeStyles[level],
      )}
    >
      <BadgeIcon level={level} />
      <span>Models {label}</span>
    </button>
  )
}