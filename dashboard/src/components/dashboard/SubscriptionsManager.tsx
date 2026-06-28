'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
  User,
  Tag,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ApiError, Subscription } from '@/lib/types'
import { addSubscription, removeSubscription } from '@/lib/dashboard-api'

interface SubscriptionsManagerProps {
  subscriptions: Subscription[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  /** Called after a successful mutation — parent refetches. */
  onMutated: () => void
}

function SubscriptionSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="size-7 rounded-md" />
      </div>
      <Skeleton className="h-3 w-48" />
    </div>
  )
}

export function SubscriptionsManager({
  subscriptions,
  loading,
  error,
  onRetry,
  onMutated,
}: SubscriptionsManagerProps) {
  const [discordId, setDiscordId] = React.useState('')
  const [item, setItem] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [removing, setRemoving] = React.useState<Set<string>>(new Set())

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = discordId.trim()
    const it = item.trim()
    if (!id || !it) {
      toast.error('Both Discord ID and item signature are required')
      return
    }
    if (!/^\d{15,20}$/.test(id)) {
      toast.error('Discord ID must be a numeric snowflake (15-20 digits)')
      return
    }
    setSubmitting(true)
    try {
      const res = await addSubscription(id, it)
      toast.success('Subscription added', {
        description: res.message ?? `Now watching "${it}" for ${id}`,
      })
      setDiscordId('')
      setItem('')
      onMutated()
    } catch (e2) {
      const msg =
        e2 && typeof e2 === 'object' && 'message' in e2
          ? (e2 as ApiError).message
          : 'Add failed'
      toast.error('Failed to add subscription', { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  const onRemove = async (sub: Subscription, itemToRemove: string) => {
    const key = `${sub.discordId}:${itemToRemove}`
    setRemoving((prev) => new Set(prev).add(key))
    try {
      const res = await removeSubscription(sub.discordId, itemToRemove)
      toast.success('Subscription removed', {
        description: res.message ?? `Stopped watching "${itemToRemove}"`,
      })
      onMutated()
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? (e as ApiError).message
          : 'Remove failed'
      toast.error('Failed to remove subscription', { description: msg })
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  // Group by discordId (the API may return duplicate discordId entries with
  // different items — flatten into per-user item lists).
  const grouped = React.useMemo(() => {
    const map = new Map<string, Subscription>()
    for (const s of subscriptions) {
      const existing = map.get(s.discordId)
      if (!existing) {
        map.set(s.discordId, { ...s, items: [...(s.items ?? [])] })
      } else {
        // Merge items
        const merged = new Set([...(existing.items ?? []), ...(s.items ?? [])])
        existing.items = [...merged]
      }
    }
    return [...map.values()].sort((a, b) =>
      a.discordId.localeCompare(b.discordId),
    )
  }, [subscriptions])

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-fuchsia-500/10 text-fuchsia-600 ring-1 ring-fuchsia-500/20 dark:text-fuchsia-400">
            <Bell className="size-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              Subscriptions
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {grouped.length} users
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Per-user flip alerts by item signature
            </CardDescription>
          </div>
        </div>

        <form onSubmit={onAdd} className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="relative">
            <User
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
              placeholder="Discord user ID"
              className="h-9 pl-8 text-sm"
              aria-label="Discord user ID"
              inputMode="numeric"
              pattern="\d{15,20}"
            />
          </div>
          <div className="relative">
            <Tag
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Item name or signature"
              className="h-9 pl-8 text-sm"
              aria-label="Item name or signature to watch"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="gap-2 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Add</span>
          </Button>
        </form>
      </CardHeader>

      <CardContent className="flex-1 p-3">
        {loading && grouped.length === 0 && (
          <div className="space-y-2">
            <SubscriptionSkeleton />
            <SubscriptionSkeleton />
          </div>
        )}

        {error && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load subscriptions</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted/60">
              <Bell className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No subscriptions yet</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Add a Discord user ID and an item signature above — they&apos;ll
                get a DM whenever the watcher detects a matching flip.
              </p>
            </div>
          </div>
        )}

        {grouped.length > 0 && (
          <div className="skybot-scroll max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {grouped.map((sub, i) => (
              <motion.div
                key={sub.discordId}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3) }}
                className="rounded-lg border border-border/50 bg-card/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-bold uppercase text-muted-foreground">
                      {sub.discordId.slice(-2)}
                    </div>
                    <div className="min-w-0">
                      <div
                        className="truncate text-xs font-semibold tabular-nums"
                        title={sub.discordId}
                      >
                        {sub.discordId}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {sub.items.length} item{sub.items.length === 1 ? '' : 's'} watched
                        {sub.minProfit ? ` • min profit ${sub.minProfit.toLocaleString()}` : ''}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {sub.items.map((it) => {
                    const key = `${sub.discordId}:${it}`
                    const isRemoving = removing.has(key)
                    return (
                      <Badge
                        key={it}
                        variant="secondary"
                        className="group gap-1 border-border/60 py-1 pl-2 pr-1 text-[11px]"
                      >
                        <span className="max-w-[160px] truncate" title={it}>
                          {it}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => onRemove(sub, it)}
                              disabled={isRemoving}
                              className="grid size-4 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Remove subscription for ${it}`}
                            >
                              {isRemoving ? (
                                <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 className="size-2.5" aria-hidden="true" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remove this item</TooltipContent>
                        </Tooltip>
                      </Badge>
                    )
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
