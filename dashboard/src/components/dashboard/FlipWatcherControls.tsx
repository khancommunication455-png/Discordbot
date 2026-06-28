'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Zap,
  Send,
  Activity,
  Eye,
  EyeOff,
  Clock,
  Coins,
  Loader2,
  Radar,
  ChevronRight,
} from 'lucide-react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ApiError, BotStats } from '@/lib/types'
import {
  forceScan,
  testPostFlip,
  formatRelativeTime,
} from '@/lib/dashboard-api'

interface FlipWatcherControlsProps {
  stats: BotStats | null
  loading: boolean
  error: ApiError | null
  /** Called after a mutation so the parent can refetch stats. */
  onMutated: () => void
}

/**
 * Horizontal control bar above the live flip feed. Shows posting status,
 * stats-only-mode badge, last-scan summary, plus the two action buttons
 * (force-scan + send test flip).
 */
export function FlipWatcherControls({
  stats,
  loading,
  error,
  onMutated,
}: FlipWatcherControlsProps) {
  const [scanning, setScanning] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  const onForceScan = async () => {
    setScanning(true)
    try {
      const res = await forceScan()
      if (res.ok) {
        toast.success('AH scan completed', {
          description: `Scanned ${res.lastScanAuctionsSeen.toLocaleString()} auctions in ${res.lastScanDurationMs}ms — ${res.lastScanFlipsFound} flip${res.lastScanFlipsFound === 1 ? '' : 's'} found`,
        })
        onMutated()
      } else {
        toast.error('Scan did not complete')
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Force scan failed', { description: err.message })
    } finally {
      setScanning(false)
    }
  }

  const onTestPost = async () => {
    setTesting(true)
    try {
      const res = await testPostFlip()
      if (res.ok) {
        toast.success('Test flip posted', {
          description: 'Check your AH flip Discord channel — a sample embed should appear',
        })
      } else {
        toast.error('Could not post test flip', {
          description: res.error ?? 'Unknown error',
        })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Test-post failed', { description: err.message })
    } finally {
      setTesting(false)
    }
  }

  if (loading && !stats) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-28" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error && !stats) {
    // Compact inline error — the parent already renders the big offline banner
    return null
  }

  if (!stats) return null

  const posting = stats.postingToDiscord && !stats.statsOnlyMode
  const statsOnly = stats.statsOnlyMode

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card
        className={cn(
          'overflow-hidden',
          posting
            ? 'border-teal-500/30 shadow-sm shadow-teal-500/5'
            : statsOnly
              ? 'border-amber-500/30 shadow-sm shadow-amber-500/5'
              : 'border-destructive/30',
        )}
      >
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* Status indicator cluster */}
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                ok={posting}
                icon={posting ? Send : EyeOff}
                label={posting ? 'Posting to Discord' : statsOnly ? 'Stats-only' : 'Not posting'}
                tone={posting ? 'teal' : statsOnly ? 'amber' : 'destructive'}
              />
              {statsOnly && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                >
                  <Eye className="size-3" aria-hidden="true" />
                  Stats-only mode
                </Badge>
              )}
              {stats.failedScans > 0 && (
                <Badge variant="destructive" className="gap-1">
                  {stats.failedScans} failed scan{stats.failedScans === 1 ? '' : 's'}
                </Badge>
              )}
            </div>

            <Separator orientation="vertical" className="hidden h-8 sm:block" />

            {/* Last scan summary */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Radar className="size-3.5 text-teal-500" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {stats.lastScanAuctionsSeen.toLocaleString()}
                </span>{' '}
                auctions scanned
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5 text-amber-500" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {stats.lastScanDurationMs.toLocaleString()}ms
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Coins className="size-3.5 text-gold-500" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {stats.lastScanFlipsFound.toLocaleString()}
                </span>{' '}
                flips found
              </span>
              <span className="flex items-center gap-1.5">
                <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {stats.lastScanAt ? formatRelativeTime(stats.lastScanAt) : 'never scanned'}
              </span>
            </div>

            {/* Action buttons */}
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onForceScan}
                disabled={scanning || testing}
                className="h-8 gap-1.5 border-teal-500/40 bg-teal-500/5 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
                aria-label="Force an immediate AH scan"
              >
                {scanning ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Zap className="size-3.5" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{scanning ? 'Scanning…' : 'Force Scan'}</span>
                <span className="sm:hidden">{scanning ? '…' : 'Scan'}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onTestPost}
                disabled={scanning || testing || !stats.AH_FLIP_CHANNEL_ID_SET}
                className="h-8 gap-1.5 border-gold-500/40 bg-gold-500/5 text-gold-600 hover:bg-gold-500/10 dark:text-gold-400"
                aria-label="Send a test flip embed to the configured Discord channel"
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-3.5" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{testing ? 'Sending…' : 'Send Test Flip'}</span>
                <span className="sm:hidden">{testing ? '…' : 'Test'}</span>
              </Button>
            </div>
          </div>

          {!stats.AH_FLIP_CHANNEL_ID_SET && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ChevronRight className="size-3 text-amber-500" aria-hidden="true" />
              Set <code className="rounded bg-muted px-1 py-0.5">AH_FLIP_CHANNEL_ID</code> in the
              Bot Configuration panel below to enable Discord posting.
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

interface StatusPillProps {
  ok: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: 'teal' | 'amber' | 'destructive'
}

function StatusPill({ ok, icon: Icon, label, tone }: StatusPillProps) {
  const toneClasses = {
    teal: 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  } as const
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        toneClasses[tone],
      )}
      role="status"
    >
      <span className="relative inline-flex">
        <span
          className={cn(
            'inline-block size-2 rounded-full',
            ok ? 'bg-teal-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-destructive',
          )}
        />
        {ok && (
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-teal-500 opacity-75" aria-hidden="true" />
        )}
      </span>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Flip watcher status: </span>
      {label}
    </div>
  )
}
