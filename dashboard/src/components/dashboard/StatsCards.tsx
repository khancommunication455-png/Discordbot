'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Server,
  Mic2,
  Coins,
  Package,
  Wifi,
  Clock,
  Users,
  Hash,
  Bell,
  Terminal,
  Globe,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApiError, BotStats } from '@/lib/types'
import {
  formatCoins,
  formatUptime,
  formatRelativeTime,
} from '@/lib/dashboard-api'

interface StatsCardsProps {
  stats: BotStats | null
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}

interface StatCardConfig {
  key: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  accent: 'teal' | 'gold' | 'amber' | 'violet'
  render: (s: BotStats) => React.ReactNode
}

const ACCENT_CLASSES: Record<StatCardConfig['accent'], { bg: string; text: string; ring: string; glow: string }> = {
  teal: {
    bg: 'bg-teal-500/10',
    text: 'text-teal-500 dark:text-teal-400',
    ring: 'ring-teal-500/20',
    glow: 'shadow-teal-500/10',
  },
  gold: {
    bg: 'bg-gold-500/10',
    text: 'text-gold-600 dark:text-gold-400',
    ring: 'ring-gold-500/20',
    glow: 'shadow-gold-500/10',
  },
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500/20',
    glow: 'shadow-amber-500/10',
  },
  violet: {
    bg: 'bg-fuchsia-500/10',
    text: 'text-fuchsia-600 dark:text-fuchsia-400',
    ring: 'ring-fuchsia-500/20',
    glow: 'shadow-fuchsia-500/10',
  },
}

function StatValue({ children }: { children: React.ReactNode }) {
  return <div className="text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{children}</div>
}

function StatRow({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  accent: StatCardConfig['accent']
}) {
  const a = ACCENT_CLASSES[accent]
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <Icon className={cn('size-3.5', a.text)} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

const CARD_CONFIGS: StatCardConfig[] = [
  {
    key: 'bot',
    title: 'Bot Status',
    icon: Server,
    accent: 'teal',
    render: (s) => (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatValue>
            <span className={s.online ? 'text-teal-500' : 'text-destructive'}>
              {s.online ? 'Online' : 'Offline'}
            </span>
          </StatValue>
          {s.online ? (
            <Badge className="border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
              <Wifi className="size-3" aria-hidden="true" /> Live
            </Badge>
          ) : (
            <Badge variant="destructive">
              <Activity className="size-3" aria-hidden="true" /> Down
            </Badge>
          )}
        </div>
        <div className="mt-2">
          <StatRow icon={Clock} label="Uptime" value={formatUptime(s.uptime)} accent="teal" />
          <StatRow icon={Users} label="Guilds" value={s.guilds.toLocaleString()} accent="teal" />
          <StatRow icon={Activity} label="Ping" value={`${s.ping}ms`} accent="teal" />
        </div>
      </div>
    ),
  },
  {
    key: 'tts',
    title: 'TTS Active Sessions',
    icon: Mic2,
    accent: 'amber',
    render: (s) => (
      <div className="space-y-1">
        <StatValue>{s.ttsSessions.toLocaleString()}</StatValue>
        <p className="text-xs text-muted-foreground">guilds with active voice</p>
        <div className="mt-2">
          <StatRow icon={Hash} label="Queue total" value={s.ttsQueueTotal.toLocaleString()} accent="amber" />
        </div>
      </div>
    ),
  },
  {
    key: 'flips',
    title: 'AH Flips Detected',
    icon: Coins,
    accent: 'gold',
    render: (s) => (
      <div className="space-y-1">
        <StatValue>{s.flipsDetected.toLocaleString()}</StatValue>
        <p className="text-xs text-muted-foreground">all-time detected flips</p>
        <div className="mt-2">
          <StatRow
            icon={Coins}
            label="Total profit"
            value={
              <span className="text-gold-600 dark:text-gold-400">
                {formatCoins(s.totalProfitCoins)}
              </span>
            }
            accent="gold"
          />
        </div>
      </div>
    ),
  },
  {
    key: 'items',
    title: 'Items Tracked',
    icon: Package,
    accent: 'violet',
    render: (s) => (
      <div className="space-y-1">
        <StatValue>{s.itemsTracked.toLocaleString()}</StatValue>
        <p className="text-xs text-muted-foreground">price-history signatures</p>
        <div className="mt-2">
          <StatRow
            icon={Clock}
            label="Last scan"
            value={s.lastScanAt ? formatRelativeTime(s.lastScanAt) : 'never'}
            accent="violet"
          />
        </div>
      </div>
    ),
  },
  {
    key: 'auctionSold',
    title: 'Auction Sold Alerts',
    icon: Bell,
    accent: 'amber',
    render: (s) => (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatValue>
            <span className="text-amber-600 dark:text-amber-400">
              {s.auctionSoldAlerts.toLocaleString()}
            </span>
          </StatValue>
          <Badge
            variant="outline"
            className={cn(
              'gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
            )}
          >
            <Bell className="size-3" aria-hidden="true" />
            alerts
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">sold-BIN notifications sent</p>
        <div className="mt-2">
          <StatRow icon={Users} label="Tracked players" value={s.linkedPlayers.toLocaleString()} accent="amber" />
        </div>
      </div>
    ),
  },
  {
    key: 'commands',
    title: 'Slash Commands',
    icon: Terminal,
    accent: 'teal',
    render: (s) => (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatValue>
            <span className={s.commandsRegistered ? 'text-teal-500' : 'text-muted-foreground'}>
              {s.commandCount.toLocaleString()}
            </span>
          </StatValue>
          {s.commandsRegistered ? (
            <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
              {s.deployScope === 'guild' ? (
                <>
                  <Hash className="size-3" aria-hidden="true" /> guild
                </>
              ) : (
                <>
                  <Globe className="size-3" aria-hidden="true" /> global
                </>
              )}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground">
              not registered
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {s.commandsRegistered
            ? `registered ${s.commandsRegisteredAt ? formatRelativeTime(s.commandsRegisteredAt) : ''}`
            : 'use Redeploy Commands below'}
        </p>
      </div>
    ),
  },
]

function StatCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="size-9 rounded-lg" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="mt-2 h-3 w-40" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </CardContent>
    </Card>
  )
}

function ErrorCard({ title, error, onRetry }: {
  title: string
  error: ApiError
  onRetry: () => void
}) {
  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-destructive">{error.message}</p>
        <Button size="sm" variant="outline" className="mt-3 h-7" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  )
}

export function StatsCards({ stats, loading, error, onRetry }: StatsCardsProps) {
  return (
    <section aria-label="Bot overview statistics" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {CARD_CONFIGS.map((cfg, i) => {
          const a = ACCENT_CLASSES[cfg.accent]
          const Icon = cfg.icon

          if (loading && !stats) {
            return <StatCardSkeleton key={cfg.key} />
          }
          if (error && !stats) {
            return (
              <ErrorCard
                key={cfg.key}
                title={cfg.title}
                error={error}
                onRetry={onRetry}
              />
            )
          }
          if (!stats) {
            return <StatCardSkeleton key={cfg.key} />
          }

          return (
            <motion.div
              key={cfg.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              whileHover={{ y: -2 }}
            >
              <Card className={cn('h-full overflow-hidden shadow-sm', a.glow)}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm">
                      {cfg.title}
                    </CardTitle>
                    <div
                      className={cn(
                        'grid size-9 place-items-center rounded-lg ring-1',
                        a.bg,
                        a.text,
                        a.ring,
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">{cfg.render(stats)}</CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

export { StatCardSkeleton }
export type { StatCardConfig }
