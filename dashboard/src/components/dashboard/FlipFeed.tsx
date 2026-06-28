'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Zap,
  Pause,
  Play,
  Search,
  AlertTriangle,
  Loader2,
  Coins,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ApiError, Flip } from '@/lib/types'
import { FlipCard } from './FlipCard'

interface FlipFeedProps {
  flips: Flip[]
  loading: boolean
  error: ApiError | null
  paused: boolean
  onTogglePause: () => void
  onRetry: () => void
  /** Polling cadence — shown as a hint to the user. */
  pollIntervalMs: number
  /** Seconds since last successful poll — shown when paused. */
  lastPollMs: number | null
}

function FlipCardSkeleton() {
  return (
    <Card className="overflow-hidden p-0 py-0">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-muted" />
      <div className="space-y-3 p-3 pl-4 sm:p-4 sm:pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-14 w-full" />
        <div className="flex flex-wrap gap-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
        <Skeleton className="h-7 w-full" />
      </div>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-muted/60">
        <Coins className="size-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No flips detected yet</p>
        <p className="text-xs text-muted-foreground">
          The watcher may be starting up or no underpriced BIN auctions were
          found in the last scan.
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">Failed to load flips</p>
        <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
        Retry
      </Button>
    </div>
  )
}

export function FlipFeed({
  flips,
  loading,
  error,
  paused,
  onTogglePause,
  onRetry,
  pollIntervalMs,
  lastPollMs,
}: FlipFeedProps) {
  const [query, setQuery] = React.useState('')
  // Debounce the search input by 200ms
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim().toLowerCase()), 200)
    return () => clearTimeout(id)
  }, [query])

  const filtered = React.useMemo(() => {
    if (!debounced) return flips
    return flips.filter(
      (f) =>
        f.attributes.name.toLowerCase().includes(debounced) ||
        f.attributes.tier.toLowerCase().includes(debounced),
    )
  }, [flips, debounced])

  const showSkeleton = loading && flips.length === 0
  const showError = !!error && flips.length === 0
  const showEmpty = !loading && !error && filtered.length === 0

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-teal-500/10 text-teal-500 ring-1 ring-teal-500/20">
              <Zap className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                Live AH Flip Feed
                <Badge
                  variant="secondary"
                  className={cn(
                    'border px-1.5 py-0 text-[10px]',
                    paused
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400',
                  )}
                >
                  {paused ? 'Paused' : 'Live'}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Last 20 detected flips • auto-refresh every {pollIntervalMs / 1000}s
                {lastPollMs != null && paused && ` • updated ${Math.round((Date.now() - lastPollMs) / 1000)}s ago`}
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by item name…"
                className="h-8 w-44 pl-8 text-xs sm:w-60 sm:text-sm"
                aria-label="Filter flips by item name"
              />
            </div>
            <Button
              size="sm"
              variant={paused ? 'default' : 'outline'}
              onClick={onTogglePause}
              className={cn(
                'h-8 gap-1.5',
                paused && 'bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950',
              )}
              aria-label={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              aria-pressed={paused}
            >
              {paused ? (
                <>
                  <Play className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Resume</span>
                </>
              ) : (
                <>
                  <Pause className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Pause</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Live count strip */}
        <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {loading ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  'inline-block size-2 rounded-full',
                  paused ? 'bg-amber-500' : 'bg-teal-500',
                )}
                aria-hidden="true"
              />
            )}
            {filtered.length} of {flips.length} shown
            {debounced && ` • filter: "${debounced}"`}
          </span>
          <span className="hidden sm:inline">Click any auction row to copy the /viewauction command</span>
        </div>

        {/* List */}
        <div
          className="skybot-scroll max-h-[640px] overflow-y-auto p-3 sm:p-4"
          role="region"
          aria-label="Recent flips list"
          aria-live="polite"
        >
          {showSkeleton && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <FlipCardSkeleton key={i} />
              ))}
            </div>
          )}

          {showError && <ErrorState error={error!} onRetry={onRetry} />}

          {showEmpty && !debounced && <EmptyState />}

          {showEmpty && debounced && (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <Search className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm">No flips match &quot;{debounced}&quot;</p>
              <Button
                size="sm"
                variant="link"
                className="h-7"
                onClick={() => setQuery('')}
              >
                Clear filter
              </Button>
            </div>
          )}

          {!showSkeleton && !showError && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {filtered.map((flip, i) => (
                  <FlipCard key={`${flip.uuid}-${flip.detectedAt}`} flip={flip} index={i} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Re-export for consumers that want just the skeleton
export { FlipCardSkeleton }
