'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  LineChart,
  Search,
  Loader2,
  AlertTriangle,
  PackageSearch,
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { PriceLookup } from '@/lib/types'
import {
  formatCoins,
  formatCoinsFull,
  formatRelativeTime,
  lookupPrice,
} from '@/lib/dashboard-api'

interface PriceLookupProps {
  /** Initial query — used to pre-fill from URL or parent state. */
  initialQuery?: string
}

interface LookupResult {
  data: PriceLookup | null
  loading: boolean
  error: string | null
}

function PriceStat({
  label,
  value,
  hint,
  color,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 text-sm font-bold tabular-nums sm:text-base',
          color,
        )}
        title={hint}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Render a simple SVG bar chart of the histogram (10 buckets between min..max).
 * Pure SVG — no chart library dependency.
 */
function HistogramChart({ histogram }: { histogram: number[] }) {
  if (!histogram || histogram.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
        No histogram data
      </div>
    )
  }
  const max = Math.max(...histogram, 1)
  const barW = 100 / histogram.length
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Price distribution</span>
        <span>{histogram.length} buckets</span>
      </div>
      <div className="flex h-20 items-end gap-0.5">
        {histogram.map((count, i) => {
          const h = Math.max(2, (count / max) * 100)
          return (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ duration: 0.4, delay: i * 0.03 }}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-teal-600/60 to-teal-400/90"
              style={{ minWidth: `${barW}%` }}
              title={`${count} samples`}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>min</span>
        <span>max</span>
      </div>
    </div>
  )
}

export function PriceLookup({ initialQuery = '' }: PriceLookupProps) {
  const [query, setQuery] = React.useState(initialQuery)
  const [result, setResult] = React.useState<LookupResult>({
    data: null,
    loading: false,
    error: null,
  })

  const runLookup = React.useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResult({ data: null, loading: false, error: null })
      return
    }
    setResult({ data: null, loading: true, error: null })
    try {
      const data = await lookupPrice(trimmed)
      setResult({ data, loading: false, error: null })
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? (e as { message: string }).message
          : 'Lookup failed'
      setResult({ data: null, loading: false, error: msg })
    }
  }, [])

  // Debounced auto-lookup when query changes
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (query.trim()) runLookup(query)
    }, 400)
    return () => clearTimeout(id)
  }, [query, runLookup])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    runLookup(query)
  }

  const hasData = !!result.data
  const hasError = !!result.error
  const noMatch = !result.loading && !hasError && !hasData && query.trim().length > 0

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-teal-500/10 text-teal-500 ring-1 ring-teal-500/20 dark:text-teal-400">
            <LineChart className="size-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base sm:text-lg">Price History Lookup</CardTitle>
            <CardDescription className="text-xs">
              EWMA market price &amp; percentiles per signature
            </CardDescription>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-1 flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Item name e.g. Shadow Assassin Helmet"
              className="h-9 pl-8 text-sm"
              aria-label="Item name to look up"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="submit"
            size="default"
            disabled={result.loading || !query.trim()}
            className="gap-2 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
          >
            {result.loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Lookup</span>
          </Button>
        </form>
      </CardHeader>

      <CardContent className="flex-1 p-4">
        {result.loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {hasError && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Lookup failed</p>
              <p className="max-w-md text-xs text-muted-foreground">{result.error}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runLookup(query)}
              className="h-8"
            >
              Retry
            </Button>
          </div>
        )}

        {noMatch && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted/60">
              <PackageSearch className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No price history for &quot;{query}&quot;</p>
              <p className="max-w-md text-xs text-muted-foreground">
                The bot hasn&apos;t seen this item yet — try a partial name like
                &quot;Shadow&quot; or wait for the next AH scan.
              </p>
            </div>
          </div>
        )}

        {!result.loading && !hasError && !hasData && !noMatch && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted/60">
              <TrendingUp className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Look up an item</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Type an item name above to see its EWMA market price, percentile
                floor, sample count, and price distribution.
              </p>
            </div>
          </div>
        )}

        {hasData && result.data && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-3"
          >
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground" title={result.data.signature}>
                  {result.data.signature}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  Last seen {formatRelativeTime(result.data.lastSeen)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <PriceStat
                label="EWMA"
                value={formatCoins(result.data.ewma)}
                hint={formatCoinsFull(result.data.ewma)}
                color="text-teal-600 dark:text-teal-400"
              />
              <PriceStat
                label="P5 floor"
                value={formatCoins(result.data.p5)}
                hint={formatCoinsFull(result.data.p5)}
                color="text-amber-600 dark:text-amber-400"
              />
              <PriceStat
                label="P50 median"
                value={formatCoins(result.data.p50)}
                hint={formatCoinsFull(result.data.p50)}
              />
              <PriceStat
                label="Min"
                value={formatCoins(result.data.min)}
                hint={formatCoinsFull(result.data.min)}
              />
              <PriceStat
                label="Max"
                value={formatCoins(result.data.max)}
                hint={formatCoinsFull(result.data.max)}
              />
              <PriceStat
                label="Samples"
                value={result.data.count.toLocaleString()}
                color="text-fuchsia-600 dark:text-fuchsia-400"
              />
            </div>

            <div className="rounded-lg border border-border/40 p-3">
              <HistogramChart histogram={result.data.histogram ?? []} />
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}
