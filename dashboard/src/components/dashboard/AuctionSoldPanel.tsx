'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  Coins,
  Users,
  Radar,
  Clock,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ApiError, AuctionSoldStats as AuctionSoldStatsT } from '@/lib/types'
import {
  formatCoins,
  formatRelativeTime,
} from '@/lib/dashboard-api'

interface AuctionSoldPanelProps {
  stats: AuctionSoldStatsT | null
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}

/**
 * Compact stats card — surfaces the auction-sold watcher's activity:
 * alerts sent, players tracked, last-check time, plus per-scan deltas.
 */
export function AuctionSoldPanel({ stats, loading, error, onRetry }: AuctionSoldPanelProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
              <Bell className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                Auction Sold Alerts
              </CardTitle>
              <CardDescription className="text-xs">
                Tracks linked players&apos; BIN auctions as they sell
              </CardDescription>
            </div>
          </div>
          {stats && (
            <Badge
              variant="outline"
              className={cn(
                'gap-1',
                stats.playersTracked > 0
                  ? 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400'
                  : 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              <Users className="size-3" aria-hidden="true" />
              {stats.playersTracked} tracked
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {loading && !stats && (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}

        {error && !stats && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load auction-sold stats</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-3"
          >
            {/* Top metric row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  <Bell className="size-3" aria-hidden="true" />
                  Alerts Sent
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {stats.totalAlertsSent.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gold-600 dark:text-gold-400">
                  <Coins className="size-3" aria-hidden="true" />
                  Coins Tracked
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-gold-600 dark:text-gold-400">
                  {formatCoins(stats.totalCoinsTracked)}
                </div>
              </div>
            </div>

            {/* Per-scan summary */}
            <div className="space-y-1.5 rounded-lg border border-border/40 bg-card/40 p-3">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Radar className="size-3" aria-hidden="true" />
                  Last scan
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />
                  {stats.lastScanAt ? formatRelativeTime(stats.lastScanAt) : 'never'}
                </span>
              </div>
              <SummaryRow
                icon={Users}
                label="Players checked"
                value={stats.lastScanPlayersChecked.toLocaleString()}
              />
              <SummaryRow
                icon={Radar}
                label="Auctions checked"
                value={stats.lastScanAuctionsChecked.toLocaleString()}
              />
              <SummaryRow
                icon={TrendingUp}
                label="Newly sold"
                value={stats.lastScanNewlySold.toLocaleString()}
                accent={stats.lastScanNewlySold > 0 ? 'teal' : undefined}
              />
            </div>

            {stats.failedScans > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                <AlertTriangle className="size-3" aria-hidden="true" />
                {stats.failedScans} scan{stats.failedScans === 1 ? '' : 's'} failed
                {' — '}last took {stats.lastScanDurationMs.toLocaleString()}ms
              </div>
            )}

            {stats.playersTracked === 0 && (
              <p className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                No linked players to watch. Users can link with{' '}
                <code className="rounded bg-muted px-1 py-0.5">/link &lt;ign&gt;</code>{' '}
                in Discord — their BIN auctions will be monitored for sales.
              </p>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryRow({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent?: 'teal'
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </span>
      <span
        className={cn(
          'font-semibold tabular-nums',
          accent === 'teal' && 'text-teal-600 dark:text-teal-400',
        )}
      >
        {value}
      </span>
    </div>
  )
}
