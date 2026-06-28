'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Trophy, AlertTriangle, Crown } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApiError, Flip } from '@/lib/types'
import {
  formatCoins,
  formatCoinsFull,
  formatTimestamp,
  tierColorHex,
} from '@/lib/dashboard-api'

interface TopFlipsLeaderboardProps {
  flips: Flip[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}

function medalFor(rank: number): { icon: string; className: string } | null {
  if (rank === 0) return { icon: '🥇', className: 'text-gold-500' }
  if (rank === 1) return { icon: '🥈', className: 'text-zinc-400' }
  if (rank === 2) return { icon: '🥉', className: 'text-amber-700' }
  return null
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function TopFlipsLeaderboard({
  flips,
  loading,
  error,
  onRetry,
}: TopFlipsLeaderboardProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-gold-500/10 text-gold-600 ring-1 ring-gold-500/20 dark:text-gold-400">
            <Trophy className="size-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              Top Flips Leaderboard
            </CardTitle>
            <CardDescription className="text-xs">
              All-time most profitable detections
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        {loading && flips.length === 0 && <LeaderboardSkeleton />}

        {error && flips.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load leaderboard</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && flips.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <Crown className="size-7 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No top flips yet</p>
            <p className="text-xs text-muted-foreground">
              Detected flips will be ranked here once the watcher starts catching deals.
            </p>
          </div>
        )}

        {!loading && flips.length > 0 && (
          <div className="skybot-scroll max-h-[480px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="w-10 pl-3 text-[11px] uppercase">#</TableHead>
                  <TableHead className="text-[11px] uppercase">Item</TableHead>
                  <TableHead className="text-right text-[11px] uppercase">Profit</TableHead>
                  <TableHead className="hidden text-right text-[11px] uppercase sm:table-cell">
                    Margin
                  </TableHead>
                  <TableHead className="hidden pr-3 text-right text-[11px] uppercase md:table-cell">
                    Date
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flips.map((f, i) => {
                  const medal = medalFor(i)
                  const tierHex = tierColorHex(f.attributes.tier)
                  return (
                    <motion.tr
                      key={`${f.uuid}-${f.detectedAt}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
                      className="group border-border/40 transition-colors hover:bg-muted/40"
                    >
                      <TableCell className="pl-3">
                        <div className="flex items-center gap-1">
                          {medal ? (
                            <span className="text-base" aria-label={`Rank ${i + 1}`}>
                              {medal.icon}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                              {i + 1}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-8 w-1 shrink-0 rounded-full"
                            style={{ background: tierHex }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div
                              className="max-w-[160px] truncate text-xs font-medium sm:max-w-[200px]"
                              title={f.attributes.name}
                            >
                              {f.attributes.name}
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant="outline"
                                className="border-border/40 px-1 py-0 text-[9px] font-medium uppercase"
                                style={{ color: tierHex }}
                              >
                                {f.attributes.tier || '—'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className="text-xs font-bold tabular-nums text-gold-600 dark:text-gold-400 sm:text-sm"
                          title={formatCoinsFull(f.profit)}
                        >
                          +{formatCoins(f.profit)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          +{f.marginPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="hidden pr-3 text-right text-[11px] text-muted-foreground md:table-cell">
                        {formatTimestamp(f.detectedAt)}
                      </TableCell>
                    </motion.tr>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
