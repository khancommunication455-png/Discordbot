'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  XCircle,
  Rocket,
  AlertTriangle,
  ChevronDown,
  Terminal,
  Send,
  RefreshCw,
  Loader2,
  Hash,
  KeyRound,
  Bot as BotIcon,
  Sparkles,
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  ApiError,
  FirstRunStatus,
  SetupChecklistItem,
} from '@/lib/types'
import { updateConfig, redeployCommands } from '@/lib/dashboard-api'

interface SetupChecklistProps {
  status: FirstRunStatus | null
  loading: boolean
  error: ApiError | null
  /** Triggered after a mutation so the parent can refetch stats + config. */
  onMutated: () => void
}

/**
 * First-run deployment readiness panel — sits at the very top of the
 * dashboard. Each item renders a green ✅ or red ❌ with an inline hint.
 * When all `critical` items pass, the panel collapses automatically and a
 * "🚀 Ready to flip!" badge is shown.
 */
export function SetupChecklist({ status, loading, error, onMutated }: SetupChecklistProps) {
  // Auto-collapse once everything is green; users can still re-open it.
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => {
    if (status?.ready) setOpen(false)
    else if (status && !status.ready) setOpen(true)
  }, [status?.ready])

  // Channel-ID quick-fix input (used in the stats-only-mode warning banner)
  const [channelId, setChannelId] = React.useState('')
  const [savingChannel, setSavingChannel] = React.useState(false)

  // Redeploy-commands button
  const [redeploying, setRedeploying] = React.useState(false)

  if (loading && !status) {
    return (
      <Card className="overflow-hidden border-amber-500/30">
        <CardHeader className="gap-2 border-b border-border/60 bg-amber-500/5 pb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (error && !status) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            Setup status unavailable
          </CardTitle>
          <CardDescription className="text-xs">{error.message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!status) return null

  const onSaveChannel = async () => {
    const id = channelId.trim()
    if (!id) {
      toast.error('Enter a channel ID first')
      return
    }
    if (!/^\d{15,20}$/.test(id)) {
      toast.error('Channel ID must be a numeric snowflake (15-20 digits)')
      return
    }
    setSavingChannel(true)
    try {
      await updateConfig({ AH_FLIP_CHANNEL_ID: id })
      toast.success('Channel ID saved — flip watcher will start posting on next scan')
      setChannelId('')
      onMutated()
    } catch (e) {
      const err = e as ApiError
      toast.error('Failed to save channel ID', { description: err.message })
    } finally {
      setSavingChannel(false)
    }
  }

  const onRedeploy = async () => {
    setRedeploying(true)
    try {
      const res = await redeployCommands()
      if (res.ok) {
        toast.success(`Redeployed ${res.count} slash command${res.count === 1 ? '' : 's'} (${res.scope} scope)`, {
          description: res.scope === 'guild'
            ? 'Guild registration is instant — commands are usable now.'
            : 'Global registration takes ~1hr to propagate across Discord.',
        })
        onMutated()
      } else {
        toast.error('Could not redeploy commands', {
          description: res.error ?? 'Unknown error',
        })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Could not redeploy commands', { description: err.message })
    } finally {
      setRedeploying(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className={cn(
          'overflow-hidden transition-colors',
          status.ready
            ? 'border-teal-500/40 shadow-sm shadow-teal-500/10'
            : 'border-amber-500/40 shadow-sm shadow-amber-500/10',
        )}
      >
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardHeader
            className={cn(
              'gap-2 border-b pb-4',
              status.ready ? 'border-teal-500/20 bg-teal-500/5' : 'border-amber-500/20 bg-amber-500/5',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'grid size-9 place-items-center rounded-lg ring-1',
                    status.ready
                      ? 'bg-teal-500/15 text-teal-600 ring-teal-500/30 dark:text-teal-400'
                      : 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400',
                  )}
                >
                  {status.ready ? (
                    <Rocket className="size-4" aria-hidden="true" />
                  ) : (
                    <Terminal className="size-4" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                    First-Run Setup
                    {status.ready ? (
                      <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
                        <Rocket className="size-3" aria-hidden="true" />
                        Ready to flip!
                      </Badge>
                    ) : (
                      <Badge className="gap-1 border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {status.passedCritical}/{status.totalCritical} critical checks
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {status.ready
                      ? 'All critical checks pass — your bot is fully operational.'
                      : 'Resolve the red items below to get your bot production-ready.'}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!status.ready && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRedeploy}
                    disabled={redeploying}
                    className="h-8 gap-1.5"
                  >
                    {redeploying ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">Redeploy Commands</span>
                    <span className="sm:hidden">Redeploy</span>
                  </Button>
                )}
                <CollapsibleTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2"
                    aria-label={open ? 'Collapse setup checklist' : 'Expand setup checklist'}
                  >
                    <ChevronDown
                      className={cn('size-3.5 transition-transform', open && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-3 p-4">
              <AnimatePresence initial={false}>
                {status.statsOnlyMode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mb-3 flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                            Stats-only mode is ON
                          </p>
                          <p className="text-xs text-muted-foreground">
                            The bot is scanning AH and building price history but is <strong>not</strong> posting
                            flips to Discord. Set a channel ID below to enable posting.
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          value={channelId}
                          onChange={(e) => setChannelId(e.target.value)}
                          placeholder="Channel ID (e.g. 123456789012345678)"
                          inputMode="numeric"
                          className="h-8 w-full font-mono text-xs sm:w-64"
                          aria-label="Discord channel ID for AH flip posts"
                        />
                        <Button
                          size="sm"
                          onClick={onSaveChannel}
                          disabled={savingChannel}
                          className="h-8 shrink-0 gap-1.5 bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-amber-950"
                        >
                          {savingChannel ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="size-3.5" aria-hidden="true" />
                          )}
                          <span className="hidden sm:inline">Save</span>
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {status.items.map((item, i) => (
                  <ChecklistRow
                    key={item.key}
                    item={item}
                    index={i}
                    onRedeploy={onRedeploy}
                    redeploying={redeploying}
                  />
                ))}
              </div>

              <p className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                Secrets (<code>DISCORD_TOKEN</code>, <code>CLIENT_ID</code>, <code>HYPIXEL_API_KEY</code>,
                <code>GROQ_API_KEY</code>) must be set as Railway environment variables — they cannot be
                edited from the dashboard. Channel IDs and tuning values can be edited in the
                Bot Configuration panel below.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </motion.div>
  )
}

function ChecklistRow({
  item,
  index,
  onRedeploy,
  redeploying,
}: {
  item: SetupChecklistItem
  index: number
  onRedeploy: () => void
  redeploying: boolean
}) {
  const isCommand = item.key === 'commands_registered'
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors',
        item.ok
          ? 'border-teal-500/30 bg-teal-500/5'
          : item.severity === 'critical'
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
            item.ok
              ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400'
              : item.severity === 'critical'
                ? 'bg-destructive/20 text-destructive'
                : 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
          )}
          aria-hidden="true"
        >
          {item.ok ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <XCircle className="size-3.5" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold">{item.label}</span>
            <Badge
              variant="outline"
              className={cn(
                'px-1 py-0 text-[9px]',
                item.severity === 'critical'
                  ? 'border-destructive/30 text-destructive'
                  : 'border-amber-500/30 text-amber-600 dark:text-amber-400',
              )}
            >
              {item.severity === 'critical' ? 'critical' : 'optional'}
            </Badge>
            <span className="sr-only">
              {item.label}: {item.ok ? 'passed' : 'failed'}
            </span>
          </div>
          {!item.ok && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
          )}
        </div>
      </div>

      {isCommand && !item.ok && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRedeploy}
          disabled={redeploying}
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
        >
          {redeploying ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3" aria-hidden="true" />
          )}
          Redeploy
        </Button>
      )}
    </motion.div>
  )
}

/** Inline icon map for setup row hints (kept tiny for visual rhythm). */
export const SETUP_ROW_ICONS = {
  discord_token: KeyRound,
  client_id: BotIcon,
  hypixel_api_key: Sparkles,
  groq_api_key: Sparkles,
  ah_flip_channel_id: Hash,
  commands_registered: Terminal,
  welcome_posted: Send,
  posting_to_discord: Send,
} as const
