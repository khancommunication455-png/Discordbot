'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Mic2,
  Volume2,
  VolumeX,
  Bot as BotIcon,
  Radio,
  AlertTriangle,
  RefreshCw,
  Hash,
  Users,
  Loader2,
  CheckCircle2,
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
import { toast } from 'sonner'
import type { ApiError, TTSSession } from '@/lib/types'
import { reconnectTTS } from '@/lib/dashboard-api'

interface TTSSessionsProps {
  sessions: TTSSession[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}

function SessionSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="size-7 rounded-md" />
      </div>
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-3 w-40" />
    </div>
  )
}

export function TTSSessions({ sessions, loading, error, onRetry }: TTSSessionsProps) {
  const [reconnecting, setReconnecting] = React.useState<Set<string>>(new Set())

  const onReconnect = async (guildId: string, guildName: string) => {
    setReconnecting((prev) => new Set(prev).add(guildId))
    try {
      const res = await reconnectTTS(guildId)
      toast.success(`Reconnect requested for "${guildName}"`, {
        description: res.message ?? 'The bot will rejoin the voice channel.',
      })
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Reconnect failed'
      toast.error(`Reconnect failed for "${guildName}"`, { description: msg })
    } finally {
      setReconnecting((prev) => {
        const next = new Set(prev)
        next.delete(guildId)
        return next
      })
    }
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
              <Mic2 className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                TTS Sessions
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {sessions.length} active
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Live voice channels with the bot
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-3">
        {loading && sessions.length === 0 && (
          <div className="space-y-2">
            <SessionSkeleton />
            <SessionSkeleton />
          </div>
        )}

        {error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load TTS sessions</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted/60">
              <VolumeX className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No active TTS sessions</p>
              <p className="text-xs text-muted-foreground">
                Use the <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/tts</code> command in a
                guild to start a session.
              </p>
            </div>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="skybot-scroll max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {sessions.map((s, i) => {
              const isReconnecting = reconnecting.has(s.guildId)
              return (
                <motion.div
                  key={s.guildId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3) }}
                  className={cn(
                    'rounded-lg border bg-card/40 p-3 transition-colors hover:bg-card/70',
                    s.connectionDead ? 'border-destructive/30' : 'border-border/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span
                          className="truncate text-sm font-semibold"
                          title={s.guildName || s.guildId}
                        >
                          {s.guildName || s.guildId}
                        </span>
                        {s.speaking ? (
                          <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 px-1.5 py-0 text-[10px] text-teal-600 dark:text-teal-400">
                            <Radio className="size-2.5 animate-pulse" aria-hidden="true" />
                            Speaking
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            Idle
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                        <span className="inline-flex items-center gap-1">
                          <Volume2 className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate" title={s.voiceChannelName || s.voiceChannelId}>
                            {s.voiceChannelName || s.voiceChannelId || '—'}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Hash className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate" title={s.textChannelName || s.textChannelId}>
                            {s.textChannelName || s.textChannelId || '—'}
                          </span>
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReconnect(s.guildId, s.guildName || s.guildId)}
                      disabled={isReconnecting}
                      className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                      aria-label={`Force reconnect TTS for ${s.guildName || s.guildId}`}
                    >
                      {isReconnecting ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-3" aria-hidden="true" />
                      )}
                      <span className="hidden sm:inline">
                        {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
                      </span>
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {s.aiMode && (
                      <Badge className="gap-1 border-fuchsia-500/30 bg-fuchsia-500/15 px-1.5 py-0 text-[10px] text-fuchsia-600 dark:text-fuchsia-300">
                        <BotIcon className="size-2.5" aria-hidden="true" />
                        AI Mode
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px] tabular-nums"
                    >
                      Queue: {s.queueSize}
                    </Badge>
                    {s.connectionDead ? (
                      <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                        <AlertTriangle className="size-2.5" aria-hidden="true" />
                        Connection Dead
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="gap-1 border-teal-500/30 px-1.5 py-0 text-[10px] text-teal-600 dark:text-teal-400"
                      >
                        <CheckCircle2 className="size-2.5" aria-hidden="true" />
                        Healthy
                      </Badge>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
