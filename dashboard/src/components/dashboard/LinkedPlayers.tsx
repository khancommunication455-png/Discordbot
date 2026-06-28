'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Users,
  Link2,
  AlertTriangle,
  UserCheck,
  Hash,
  Clock,
  Gamepad2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ApiError, LinkedPlayer } from '@/lib/types'
import { formatRelativeTime, formatTimestamp } from '@/lib/dashboard-api'

interface LinkedPlayersProps {
  players: LinkedPlayer[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}

/** Truncate a snowflake / uuid — keep first N + last N chars separated by an ellipsis. */
function truncateMiddle(s: string, head = 6, tail = 4): string {
  if (!s) return '—'
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

export function LinkedPlayers({ players, loading, error, onRetry }: LinkedPlayersProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-fuchsia-500/10 text-fuchsia-500 ring-1 ring-fuchsia-500/20 dark:text-fuchsia-400">
              <Link2 className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                Linked Players
              </CardTitle>
              <CardDescription className="text-xs">
                Discord ↔ Hypixel account mappings
              </CardDescription>
            </div>
          </div>
          {players.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <UserCheck className="size-3" aria-hidden="true" />
              {players.length}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && players.length === 0 && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {error && players.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load linked players</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && players.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted/60 text-muted-foreground">
              <Users className="size-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No linked players yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Users can link their Hypixel account with{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">/link &lt;ign&gt;</code>{' '}
                in Discord. Linked players appear here and get tracked by the auction-sold watcher.
              </p>
            </div>
          </div>
        )}

        {players.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="skybot-scroll max-h-[28rem] overflow-y-auto"
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Discord ID
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    IGN
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    UUID
                  </TableHead>
                  <TableHead className="pr-4 text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                    Linked
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((p, i) => (
                  <motion.tr
                    key={`${p.discordId}-${p.uuid}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
                    className="hover:bg-muted/50 border-b transition-colors"
                  >
                    <TableCell className="pl-4 py-2.5">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code
                              className="cursor-help font-mono text-xs text-muted-foreground"
                              aria-label={`Discord ID: ${p.discordId}`}
                            >
                              {truncateMiddle(p.discordId)}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="font-mono text-xs">
                            {p.discordId}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="grid size-6 shrink-0 place-items-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">
                          <Gamepad2 className="size-3.5" aria-hidden="true" />
                        </div>
                        <span className="text-sm font-semibold">{p.ign}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code
                              className="cursor-help font-mono text-xs text-muted-foreground"
                              aria-label={`Hypixel UUID: ${p.uuid}`}
                            >
                              {truncateMiddle(p.uuid, 8, 4)}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="font-mono text-xs">
                            {p.uuid}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="pr-4 py-2.5 text-right">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="cursor-help text-xs text-muted-foreground"
                              aria-label={`Linked ${formatTimestamp(p.linkedAt)}`}
                            >
                              {formatRelativeTime(p.linkedAt)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" aria-hidden="true" />
                              {formatTimestamp(p.linkedAt)}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}
