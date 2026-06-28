'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Rocket,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Copy,
  ClipboardCheck,
  RefreshCw,
  Loader2,
  KeyRound,
  Hash,
  Sparkles,
  Bot as BotIcon,
  ShieldCheck,
  ExternalLink,
  Terminal,
  Send,
  Power,
  ChevronRight,
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
import { Separator } from '@/components/ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  ApiError,
  LaunchCheckKey,
  LaunchStatus,
  TokenValidation,
} from '@/lib/types'
import {
  fetchLaunchStatus,
  validateToken,
} from '@/lib/dashboard-api'

interface LaunchPanelProps {
  /** Optional initial status — parent may already have it. */
  initialStatus?: LaunchStatus | null
  /** Notify parent after a refresh so other panels can refetch too. */
  onMutated?: () => void
}

/**
 * LaunchPanel — the "Start Bot" control center.
 *
 * Renders the deployment readiness snapshot returned by `GET /api/launch/status`:
 *   - Big status card (🟢 running / 🟡 ready / 🔴 incomplete)
 *   - Environment variable checklist with copy-to-clipboard helpers
 *   - DISCORD_TOKEN validator (uses the bot's `validate-token` endpoint)
 *   - Compact 8-item launch checklist
 *   - Step-by-step deploy instructions + `.env` snippet copy button
 *
 * The "Run" action is intentionally not a button — the bot process can't
 * restart itself from within. Instead the panel guides the admin through
 * setting env vars on Railway and clicking deploy.
 */
export function LaunchPanel({ initialStatus = null, onMutated }: LaunchPanelProps) {
  const [status, setStatus] = React.useState<LaunchStatus | null>(initialStatus)
  const [loading, setLoading] = React.useState(!initialStatus)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [refreshing, setRefreshing] = useStateSafeToggle(false)

  const [tokenDraft, setTokenDraft] = React.useState('')
  const [tokenVisible, setTokenVisible] = React.useState(false)
  const [validating, setValidating] = React.useState(false)
  const [validation, setValidation] = React.useState<TokenValidation | null>(null)

  // ── Env var draft state — admin can fill these in to build a .env snippet ──
  const [envDraft, setEnvDraft] = React.useState<Record<string, string>>({
    DISCORD_TOKEN: '',
    CLIENT_ID: '',
    HYPIXEL_API_KEY: '',
    GROQ_API_KEY: '',
    AH_FLIP_CHANNEL_ID: '',
    PREMIUM_ROLE_ID: '',
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await fetchLaunchStatus()
      setStatus(s)
    } catch (e) {
      const err = e as ApiError
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!initialStatus) load()
  }, [initialStatus, load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
    onMutated?.()
    toast.success('Launch status refreshed')
  }

  // ── Token validation ─────────────────────────────────────────
  const onValidateToken = async () => {
    const t = tokenDraft.trim()
    if (!t) {
      toast.error('Paste a Discord bot token first')
      return
    }
    setValidating(true)
    setValidation(null)
    try {
      const res = await validateToken(t)
      setValidation(res)
      if (res.valid) {
        toast.success('Token is valid!', {
          description: `Bot: ${res.botTag} (ID: ${res.botId})`,
        })
      } else {
        toast.error('Token is invalid', { description: res.error ?? 'Discord rejected the token' })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Token validation failed', { description: err.message })
      setValidation({ valid: false, error: err.message })
    } finally {
      setValidating(false)
    }
  }

  // ── .env snippet copy ────────────────────────────────────────
  const buildEnvSnippet = () =>
    [
      `DISCORD_TOKEN=${envDraft.DISCORD_TOKEN || 'your_token_here'}`,
      `CLIENT_ID=${envDraft.CLIENT_ID || 'your_client_id'}`,
      `HYPIXEL_API_KEY=${envDraft.HYPIXEL_API_KEY || 'your_key'}`,
      `GROQ_API_KEY=${envDraft.GROQ_API_KEY || 'your_groq_key'}`,
      `AH_FLIP_CHANNEL_ID=${envDraft.AH_FLIP_CHANNEL_ID || 'your_channel_id'}`,
      `PREMIUM_ROLE_ID=${envDraft.PREMIUM_ROLE_ID || 'your_role_id'}`,
    ].join('\n')

  const [copied, setCopied] = React.useState(false)
  const onCopyEnv = async () => {
    const snippet = buildEnvSnippet()
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      toast.success('Copied .env snippet to clipboard', {
        description: 'Paste it into Railway → Variables',
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access')
    }
  }

  // ── Loading skeleton ─────────────────────────────────────────
  if (loading && !status) {
    return (
      <Card className="overflow-hidden border-amber-500/30">
        <CardHeader className="gap-2 border-b border-border/60 bg-amber-500/5 pb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Error state ──────────────────────────────────────────────
  if (error && !status) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            Launch status unavailable
          </CardTitle>
          <CardDescription className="text-xs">{error.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1.5">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!status) return null

  // ── Derived display state ───────────────────────────────────
  const { ready, botRunning, checks, criticalMissing, optionalMissing } = status
  const state: 'running' | 'ready' | 'incomplete' = botRunning
    ? 'running'
    : ready
      ? 'ready'
      : 'incomplete'

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className={cn(
          'overflow-hidden transition-colors',
          state === 'running'
            ? 'border-teal-500/40 shadow-sm shadow-teal-500/10'
            : state === 'ready'
              ? 'border-amber-500/40 shadow-sm shadow-amber-500/10'
              : 'border-destructive/40 shadow-sm shadow-destructive/5',
        )}
      >
        <CardHeader
          className={cn(
            'gap-2 border-b pb-4',
            state === 'running'
              ? 'border-teal-500/20 bg-teal-500/5'
              : state === 'ready'
                ? 'border-amber-500/20 bg-amber-500/5'
                : 'border-destructive/20 bg-destructive/5',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'grid size-10 place-items-center rounded-lg ring-1',
                  state === 'running'
                    ? 'bg-teal-500/15 text-teal-600 ring-teal-500/30 dark:text-teal-400'
                    : state === 'ready'
                      ? 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400'
                      : 'bg-destructive/15 text-destructive ring-destructive/30',
                )}
              >
                <Rocket className="size-5" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                  Launch Bot
                  <StatusBadge state={state} />
                </CardTitle>
                <CardDescription className="text-xs">
                  {state === 'running'
                    ? 'Bot is online and operational — no action needed.'
                    : state === 'ready'
                      ? 'All critical checks pass — deploy to Railway to start the bot.'
                      : 'Resolve the red items below before deploying.'}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={refreshing}
              className="h-8 gap-1.5"
              aria-label="Refresh launch status"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">Refresh Status</span>
              <span className="sm:hidden">Refresh</span>
            </Button>
          </div>

          {/* Inline status banner — critical missing */}
          {state === 'incomplete' && criticalMissing.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-destructive">
                    Missing critical env vars
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {status.message || criticalMissing.join(', ')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {criticalMissing.map((k) => (
                      <Badge
                        key={k}
                        variant="outline"
                        className="gap-1 border-destructive/40 text-[10px] text-destructive"
                      >
                        <XCircle className="size-2.5" aria-hidden="true" />
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {optionalMissing.length > 0 && state !== 'running' && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">Optional:</span>
              {optionalMissing.map((k) => (
                <Badge
                  key={k}
                  variant="outline"
                  className="gap-1 border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                >
                  {k}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-5 p-4 sm:p-6">
          {/* ── Token Validator ─────────────────────────────────── */}
          <section aria-label="Discord token validator" className="space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-teal-500" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Discord Token Validator</h3>
              <Badge variant="outline" className="ml-auto text-[10px]">
                step 1
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste your bot token here to verify Discord accepts it before you deploy. The token is sent
              to the bot&apos;s own <code className="rounded bg-muted px-1 py-0.5">/api/launch/validate-token</code> endpoint and is
              never stored.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Input
                  type={tokenVisible ? 'text' : 'password'}
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="Paste your bot token here (not stored)"
                  className="h-9 pr-10 font-mono text-xs"
                  aria-label="Discord bot token"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTokenVisible((v) => !v)}
                  className="absolute right-1 top-1/2 size-7 -translate-y-1/2 p-0"
                  aria-label={tokenVisible ? 'Hide token' : 'Show token'}
                >
                  {tokenVisible ? (
                    <EyeOff className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <Button
                size="sm"
                onClick={onValidateToken}
                disabled={validating || !tokenDraft.trim()}
                className="h-9 shrink-0 gap-1.5 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
              >
                {validating ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                )}
                Validate Token
              </Button>
            </div>
            <AnimatePresence mode="wait">
              {validation && (
                <motion.div
                  key={validation.valid ? 'valid' : 'invalid'}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-xs',
                    validation.valid
                      ? 'border-teal-500/40 bg-teal-500/5 text-teal-700 dark:text-teal-300'
                      : 'border-destructive/40 bg-destructive/5 text-destructive',
                  )}
                  role="status"
                >
                  {validation.valid ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    {validation.valid ? (
                      <p>
                        <strong>Valid!</strong> Bot:{' '}
                        <code className="rounded bg-muted px-1 py-0.5">{validation.botTag}</code>
                        {' '}
                        (ID: <code className="rounded bg-muted px-1 py-0.5">{validation.botId}</code>)
                        {validation.appName ? (
                          <> — app: <span className="font-medium">{validation.appName}</span></>
                        ) : null}
                      </p>
                    ) : (
                      <p>
                        <strong>Invalid:</strong> {validation.error ?? 'Discord rejected the token'}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <Separator />

          {/* ── Environment variables ───────────────────────────── */}
          <section aria-label="Environment variables" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-gold-500" aria-hidden="true" />
                <h3 className="text-sm font-semibold">Environment Variables</h3>
                <Badge variant="outline" className="text-[10px]">
                  step 2
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onCopyEnv}
                className="h-8 gap-1.5 border-gold-500/40 bg-gold-500/5 text-gold-600 hover:bg-gold-500/10 dark:text-gold-400"
                aria-label="Copy a .env snippet with all six env vars"
              >
                {copied ? (
                  <ClipboardCheck className="size-3.5 text-teal-500" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
                {copied ? 'Copied!' : 'Copy .env snippet'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Fill in the values you have, then click <strong>Copy .env snippet</strong> and paste into
              Railway → Variables. Set ones already detected by the bot are shown with a green badge.
            </p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ENV_VARS.map((v) => (
                <EnvVarRow
                  key={v.key}
                  envKey={v.key}
                  label={v.label}
                  hint={v.hint}
                  icon={v.icon}
                  critical={v.critical}
                  set={checks[v.checkKey]}
                  value={envDraft[v.key] ?? ''}
                  onChange={(val) =>
                    setEnvDraft((prev) => ({ ...prev, [v.key]: val }))
                  }
                />
              ))}
            </div>
          </section>

          <Separator />

          {/* ── Launch checklist ────────────────────────────────── */}
          <section aria-label="Launch checklist" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-teal-500" aria-hidden="true" />
                <h3 className="text-sm font-semibold">Launch Checklist</h3>
              </div>
              {ready ? (
                <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
                  <Rocket className="size-3" aria-hidden="true" />
                  Ready to Deploy!
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {Object.values(checks).filter(Boolean).length}/{Object.values(checks).length} checks
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHECKLIST_ITEMS.map((item, i) => (
                <ChecklistRow
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  ok={checks[item.key]}
                  critical={item.critical}
                  index={i}
                />
              ))}
            </div>
            {status.carryGuildCount > 0 && (
              <p className="rounded-md border border-teal-500/30 bg-teal-500/5 px-3 py-2 text-[11px] text-teal-700 dark:text-teal-300">
                <strong>{status.carryGuildCount}</strong> guild{status.carryGuildCount === 1 ? '' : 's'} have carry
                channels bound — see the Carry System panel below to manage them.
              </p>
            )}
          </section>

          <Separator />

          {/* ── Instructions ────────────────────────────────────── */}
          <section aria-label="Deploy instructions" className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
              <h3 className="text-sm font-semibold">How to start the bot</h3>
            </div>
            <ol className="space-y-2 text-xs text-muted-foreground">
              <Step n={1}>
                Set environment variables in Railway.{' '}
                <a
                  href="https://railway.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-teal-600 underline-offset-2 hover:underline dark:text-teal-400"
                >
                  railway.app <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </Step>
              <Step n={2}>
                Set <code className="rounded bg-muted px-1 py-0.5">AH_FLIP_CHANNEL_ID</code> above or in the Bot
                Configuration panel below.
              </Step>
              <Step n={3}>
                Configure carry categories in the <strong>Carry System</strong> panel below.
              </Step>
              <Step n={4}>
                Deploy to Railway — the bot auto-registers slash commands on first run.
              </Step>
              <Step n={5}>
                The bot posts a welcome message to your flip channel on first start.
              </Step>
            </ol>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
              <p className="mb-2 flex items-center gap-1.5 font-semibold text-foreground">
                <Power className="size-3.5 text-amber-500" aria-hidden="true" />
                Why is there no &quot;Run&quot; button?
              </p>
              <p className="text-muted-foreground">
                The bot process can&apos;t restart itself from within. Deploying to Railway with the
                env vars set is the &quot;Run&quot; action. This dashboard&apos;s job is to help you
                configure everything, validate the token, and produce a copy-paste <code className="rounded bg-muted px-1 py-0.5">.env</code> snippet.
              </p>
            </div>
          </section>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

interface StatusBadgeProps {
  state: 'running' | 'ready' | 'incomplete'
}

function StatusBadge({ state }: StatusBadgeProps) {
  if (state === 'running') {
    return (
      <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
        <span className="relative inline-flex">
          <span className="inline-block size-2 rounded-full bg-teal-500" />
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-teal-500 opacity-75" aria-hidden="true" />
        </span>
        Bot Running
      </Badge>
    )
  }
  if (state === 'ready') {
    return (
      <Badge className="gap-1 border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <span className="inline-block size-2 rounded-full bg-amber-500" />
        Ready to Launch
      </Badge>
    )
  }
  return (
    <Badge className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
      <span className="inline-block size-2 rounded-full bg-destructive" />
      Configuration Incomplete
    </Badge>
  )
}

interface EnvVarRowProps {
  envKey: string
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  critical: boolean
  set: boolean
  value: string
  onChange: (v: string) => void
}

function EnvVarRow({
  envKey,
  label,
  hint,
  icon: Icon,
  critical,
  set,
  value,
  onChange,
}: EnvVarRowProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border p-2.5 transition-colors',
        set
          ? 'border-teal-500/30 bg-teal-500/5'
          : critical
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <code className="truncate text-[11px] font-semibold">{envKey}</code>
        </div>
        {set ? (
          <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 px-1 py-0 text-[10px] text-teal-600 dark:text-teal-400">
            <CheckCircle2 className="size-2.5" aria-hidden="true" />
            Set
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              'gap-1 px-1 py-0 text-[10px]',
              critical
                ? 'border-destructive/40 text-destructive'
                : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
            )}
          >
            <XCircle className="size-2.5" aria-hidden="true" />
            {critical ? 'Missing' : 'Optional'}
          </Badge>
        )}
      </div>
      <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={set ? 'Already set on the bot' : label}
        disabled={set}
        className={cn(
          'h-8 font-mono text-xs',
          set && 'cursor-not-allowed opacity-60',
        )}
        aria-label={`${envKey} value for .env snippet`}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )
}

interface ChecklistRowProps {
  label: string
  hint: string
  ok: boolean
  critical: boolean
  index: number
}

function ChecklistRow({ label, hint, ok, critical, index }: ChecklistRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.3) }}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
        ok
          ? 'border-teal-500/30 bg-teal-500/5'
          : critical
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
          ok
            ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400'
            : critical
              ? 'bg-destructive/20 text-destructive'
              : 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
        )}
        aria-hidden="true"
      >
        {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold">{label}</span>
          <Badge
            variant="outline"
            className={cn(
              'px-1 py-0 text-[9px]',
              critical
                ? 'border-destructive/30 text-destructive'
                : 'border-amber-500/30 text-amber-600 dark:text-amber-400',
            )}
          >
            {critical ? 'critical' : 'optional'}
          </Badge>
          <span className="sr-only">{ok ? 'passed' : 'failed'}</span>
        </div>
        {!ok && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </motion.div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-500/15 text-[11px] font-bold text-teal-600 dark:text-teal-400">
        {n}
      </span>
      <span className="flex-1 leading-relaxed">{children}</span>
    </li>
  )
}

// ── Static metadata ────────────────────────────────────────────

interface EnvVarMeta {
  key: string
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  critical: boolean
  checkKey: LaunchCheckKey
}

const ENV_VARS: EnvVarMeta[] = [
  {
    key: 'DISCORD_TOKEN',
    label: 'Bot token from the Developer Portal',
    hint: 'Critical — the bot cannot start without it. Validate it above first.',
    icon: KeyRound,
    critical: true,
    checkKey: 'discordToken',
  },
  {
    key: 'CLIENT_ID',
    label: 'Application ID from the Developer Portal',
    hint: 'Critical — required for slash-command registration.',
    icon: BotIcon,
    critical: true,
    checkKey: 'clientId',
  },
  {
    key: 'HYPIXEL_API_KEY',
    label: '/api new on Hypixel in-game',
    hint: 'Critical — needed for AH page fetches and player data.',
    icon: Sparkles,
    critical: true,
    checkKey: 'hypixelApiKey',
  },
  {
    key: 'GROQ_API_KEY',
    label: 'Groq API key for llama-3.3-70b',
    hint: 'Optional — enables the AI assistant TTS mode. Bot runs without it.',
    icon: Sparkles,
    critical: false,
    checkKey: 'groqApiKey',
  },
  {
    key: 'AH_FLIP_CHANNEL_ID',
    label: 'Discord channel ID for flip posts',
    hint: 'Critical — without this the bot is in stats-only mode.',
    icon: Hash,
    critical: true,
    checkKey: 'flipChannelId',
  },
  {
    key: 'PREMIUM_ROLE_ID',
    label: 'Discord role ID for premium perks',
    hint: 'Optional — used by /premium add to assign a role.',
    icon: ShieldCheck,
    critical: false,
    checkKey: 'flipChannelId',
  },
]

interface ChecklistMeta {
  key: LaunchCheckKey
  label: string
  hint: string
  critical: boolean
}

const CHECKLIST_ITEMS: ChecklistMeta[] = [
  {
    key: 'discordToken',
    label: 'Discord Bot Token set',
    hint: 'Set DISCORD_TOKEN in Railway env vars.',
    critical: true,
  },
  {
    key: 'clientId',
    label: 'Discord Client ID set',
    hint: 'Set CLIENT_ID — required for slash-command registration.',
    critical: true,
  },
  {
    key: 'hypixelApiKey',
    label: 'Hypixel API Key set',
    hint: 'Set HYPIXEL_API_KEY — needed for AH page fetches.',
    critical: true,
  },
  {
    key: 'groqApiKey',
    label: 'Groq API Key set (AI mode)',
    hint: 'Optional — enables AI assistant TTS mode.',
    critical: false,
  },
  {
    key: 'flipChannelId',
    label: 'AH Flip Channel ID set',
    hint: 'Set AH_FLIP_CHANNEL_ID below or as an env var.',
    critical: true,
  },
  {
    key: 'carryChannelsSet',
    label: 'Carry channels bound',
    hint: 'Open the Carry System panel below and bind at least one channel.',
    critical: false,
  },
  {
    key: 'commandsRegistered',
    label: 'Slash commands registered',
    hint: 'Bot auto-registers on first ready event after token is set.',
    critical: true,
  },
  {
    key: 'welcomePosted',
    label: 'Welcome message posted',
    hint: 'Bot posts a welcome embed on first start.',
    critical: false,
  },
]

// ── Hooks ──────────────────────────────────────────────────────

/** Tiny helper that wraps setState to skip redundant re-toggles. */
function useStateSafeToggle(initial: boolean) {
  const [v, setV] = React.useState(initial)
  const set = React.useCallback((next: boolean) => {
    setV((prev) => (prev === next ? prev : next))
  }, [])
  return [v, set] as const
}

// Re-export for tests / storybook
export { Rocket as LaunchIcon, ChevronRight }
