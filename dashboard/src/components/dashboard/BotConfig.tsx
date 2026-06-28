'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Settings,
  CheckCircle2,
  XCircle,
  Key,
  Coins,
  Percent,
  Layers,
  Clock,
  Zap,
  Gauge,
  Hash,
  AlertTriangle,
  Save,
  RotateCcw,
  Loader2,
  Database,
  Server,
  FileQuestion,
  ShieldCheck,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  ApiError,
  ConfigKey,
  ConfigSource,
  ConfigValue,
  EditableConfig,
} from '@/lib/types'
import {
  formatCoins,
  formatCoinsFull,
  updateConfig,
} from '@/lib/dashboard-api'

interface BotConfigPanelProps {
  config: EditableConfig | null
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  /** Triggered after a successful save so the parent can refetch. */
  onMutated: () => void
}

/** Static metadata describing each editable config field. */
interface FieldMeta {
  key: ConfigKey
  label: string
  envVar: ConfigKey
  icon: React.ComponentType<{ className?: string }>
  description: string
  /** Numeric-field bounds (omit for free-form / channel-id inputs). */
  min?: number
  max?: number
  step?: number
  /** Suffix unit shown after the value, e.g. "s", "%", "coins". */
  unit?: 'coins' | 'percent' | 'seconds' | 'pages' | 'count' | 'none'
  /** Input kind — drives rendering + parsing. */
  kind: 'number' | 'channelId' | 'roleId'
}

const FIELD_METAS: FieldMeta[] = [
  {
    key: 'AH_FLIP_MIN_PROFIT',
    label: 'Min Profit',
    envVar: 'AH_FLIP_MIN_PROFIT',
    icon: Coins,
    description: 'Minimum absolute profit (coins) to flag a flip',
    min: 0,
    step: 50_000,
    unit: 'coins',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_MIN_MARGIN',
    label: 'Min Margin',
    envVar: 'AH_FLIP_MIN_MARGIN',
    icon: Percent,
    description: 'Minimum margin percent vs EWMA market price',
    min: 0,
    max: 100,
    step: 1,
    unit: 'percent',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_MAX_PAGES',
    label: 'Max Pages',
    envVar: 'AH_FLIP_MAX_PAGES',
    icon: Layers,
    description: 'Number of AH pages scanned per cycle',
    min: 1,
    max: 60,
    step: 1,
    unit: 'pages',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_INTERVAL',
    label: 'Scan Interval',
    envVar: 'AH_FLIP_INTERVAL',
    icon: Clock,
    description: 'Seconds between AH scans (min 20)',
    min: 20,
    max: 3600,
    step: 5,
    unit: 'seconds',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_MAX_PER_CYCLE',
    label: 'Max Per Cycle',
    envVar: 'AH_FLIP_MAX_PER_CYCLE',
    icon: Zap,
    description: 'Max flips surfaced per scan cycle',
    min: 1,
    max: 50,
    step: 1,
    unit: 'count',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_MIN_DEMAND',
    label: 'Min Demand',
    envVar: 'AH_FLIP_MIN_DEMAND',
    icon: Gauge,
    description: 'Minimum demand score (0-100) to flag a flip',
    min: 0,
    max: 100,
    step: 1,
    unit: 'count',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_MIN_SAMPLES',
    label: 'Min Samples',
    envVar: 'AH_FLIP_MIN_SAMPLES',
    icon: Gauge,
    description: 'Minimum price-history samples required before trusting a flip',
    min: 1,
    max: 100,
    step: 1,
    unit: 'count',
    kind: 'number',
  },
  {
    key: 'AH_FLIP_CHANNEL_ID',
    label: 'AH Flip Channel ID',
    envVar: 'AH_FLIP_CHANNEL_ID',
    icon: Hash,
    description: 'Discord channel ID where flips get posted',
    kind: 'channelId',
  },
  {
    key: 'PREMIUM_ROLE_ID',
    label: 'Premium Role ID',
    envVar: 'PREMIUM_ROLE_ID',
    icon: ShieldCheck,
    description: 'Discord role ID granted premium subscription perks (optional)',
    kind: 'roleId',
  },
]

/** Source-badge styling — DB=gold (overridden), ENV=slate, DEFAULT=grey. */
const SOURCE_STYLE: Record<
  ConfigSource,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  db: {
    label: 'DB',
    className: 'border-gold-500/40 bg-gold-500/10 text-gold-600 dark:text-gold-400',
    icon: Database,
  },
  env: {
    label: 'ENV',
    className: 'border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    icon: Server,
  },
  default: {
    label: 'DEFAULT',
    className: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
    icon: FileQuestion,
  },
}

/** Render a config value compactly for placeholder / preview. */
function formatPreviewValue(meta: FieldMeta, v: ConfigValue): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (meta.unit) {
    case 'coins':
      return `${formatCoins(typeof v === 'number' ? v : Number(v) || 0)} coins`
    case 'percent':
      return `${v}%`
    case 'seconds':
      return `${v}s`
    case 'pages':
      return `${v} pages`
    case 'count':
      return String(v)
    default:
      return String(v)
  }
}

/** Render the placeholder shown in an empty input field. */
function placeholderFor(meta: FieldMeta, config: EditableConfig | null): string {
  const def = config?.defaults?.[meta.key]
  if (def === null || def === undefined || def === '') return 'not set'
  return String(def)
}

/** Parse a raw input string into the right ConfigValue type for a key. */
function parseValue(meta: FieldMeta, raw: string): ConfigValue {
  if (raw.trim() === '') return null
  if (meta.kind === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  // Channel-id / role-id inputs are strings, but if the user typed null explicitly,
  // honour it. Otherwise treat as a snowflake string.
  if (raw.trim().toLowerCase() === 'null') return null
  return raw.trim()
}

function ConfigSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {Array.from({ length: 9 }).map((_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  )
}

export function BotConfigPanel({ config, loading, error, onRetry, onMutated }: BotConfigPanelProps) {
  // Per-field draft state — keyed by config key. Reset whenever the parent
  // passes in fresh `config.data` (e.g. after a refetch).
  const [drafts, setDrafts] = React.useState<Partial<Record<ConfigKey, string>>>({})
  const [savingKey, setSavingKey] = React.useState<ConfigKey | null>(null)
  const [resettingKey, setResettingKey] = React.useState<ConfigKey | null>(null)
  const [errors, setErrors] = React.useState<Partial<Record<ConfigKey, string>>>({})

  // Reset drafts whenever the canonical config changes
  React.useEffect(() => {
    if (!config) return
    const next: Partial<Record<ConfigKey, string>> = {}
    for (const meta of FIELD_METAS) {
      const v = config.values?.[meta.key]
      next[meta.key] = v === null || v === undefined ? '' : String(v)
    }
    setDrafts(next)
    setErrors({})
  }, [config])

  // Identify which keys have a draft that differs from the live value.
  const dirtyKeys = React.useMemo<ConfigKey[]>(() => {
    if (!config) return []
    const dirty: ConfigKey[] = []
    for (const meta of FIELD_METAS) {
      const liveRaw = config.values?.[meta.key]
      const liveStr = liveRaw === null || liveRaw === undefined ? '' : String(liveRaw)
      const draftStr = drafts[meta.key] ?? ''
      if (liveStr !== draftStr) dirty.push(meta.key)
    }
    return dirty
  }, [drafts, config])

  const onSaveKey = async (meta: FieldMeta) => {
    const raw = drafts[meta.key] ?? ''
    // Local validation for numeric bounds
    if (meta.kind === 'number') {
      const n = raw.trim() === '' ? null : Number(raw)
      if (raw.trim() !== '' && !Number.isFinite(n as number)) {
        setErrors((p) => ({ ...p, [meta.key]: 'Enter a valid number' }))
        return
      }
      if (n !== null && typeof n === 'number') {
        if (meta.min !== undefined && n < meta.min) {
          setErrors((p) => ({ ...p, [meta.key]: `Must be ≥ ${meta.min}` }))
          return
        }
        if (meta.max !== undefined && n > meta.max) {
          setErrors((p) => ({ ...p, [meta.key]: `Must be ≤ ${meta.max}` }))
          return
        }
      }
    } else {
      // Channel/role ID — must be a numeric snowflake or empty/null
      const trimmed = raw.trim()
      if (trimmed !== '' && trimmed.toLowerCase() !== 'null' && !/^\d{15,20}$/.test(trimmed)) {
        setErrors((p) => ({
          ...p,
          [meta.key]: 'Discord IDs are 15-20 digit numeric snowflakes',
        }))
        return
      }
    }
    setErrors((p) => {
      const next = { ...p }
      delete next[meta.key]
      return next
    })
    setSavingKey(meta.key)
    try {
      const value = parseValue(meta, raw)
      await updateConfig({ [meta.key]: value })
      toast.success(`${meta.label} saved`, {
        description:
          value === null
            ? `Override cleared — reverted to ${config?.sources?.[meta.key] ?? 'default'}`
            : `Now: ${formatPreviewValue(meta, value)}`,
      })
      onMutated()
    } catch (e) {
      const err = e as ApiError
      setErrors((p) => ({ ...p, [meta.key]: err.message }))
      toast.error(`Could not save ${meta.label}`, { description: err.message })
    } finally {
      setSavingKey(null)
    }
  }

  const onResetKey = async (meta: FieldMeta) => {
    setResettingKey(meta.key)
    try {
      await updateConfig({ [meta.key]: null })
      toast.success(`${meta.label} reset`, {
        description: 'Override cleared — value reverted to env/default',
      })
      onMutated()
    } catch (e) {
      const err = e as ApiError
      toast.error(`Could not reset ${meta.label}`, { description: err.message })
    } finally {
      setResettingKey(null)
    }
  }

  const onSaveAll = async () => {
    if (dirtyKeys.length === 0) {
      toast.info('No unsaved changes')
      return
    }
    const metas = FIELD_METAS.filter((m) => dirtyKeys.includes(m.key))
    // Local-validate every dirty key first; abort if any fail.
    const patch: Partial<Record<ConfigKey, ConfigValue>> = {}
    const newErrors: Partial<Record<ConfigKey, string>> = {}
    for (const meta of metas) {
      const raw = drafts[meta.key] ?? ''
      if (meta.kind === 'number') {
        const n = raw.trim() === '' ? null : Number(raw)
        if (raw.trim() !== '' && !Number.isFinite(n as number)) {
          newErrors[meta.key] = 'Enter a valid number'
          continue
        }
        if (n !== null && typeof n === 'number') {
          if (meta.min !== undefined && n < meta.min) {
            newErrors[meta.key] = `Must be ≥ ${meta.min}`
            continue
          }
          if (meta.max !== undefined && n > meta.max) {
            newErrors[meta.key] = `Must be ≤ ${meta.max}`
            continue
          }
        }
        patch[meta.key] = n
      } else {
        const trimmed = raw.trim()
        if (trimmed !== '' && trimmed.toLowerCase() !== 'null' && !/^\d{15,20}$/.test(trimmed)) {
          newErrors[meta.key] = 'Discord IDs are 15-20 digit numeric snowflakes'
          continue
        }
        patch[meta.key] = parseValue(meta, raw)
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors((p) => ({ ...p, ...newErrors }))
      toast.error('Fix validation errors first', {
        description: `${Object.keys(newErrors).length} field(s) need attention`,
      })
      return
    }
    setSavingKey('__all__')
    try {
      await updateConfig(patch)
      toast.success(`Saved ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`, {
        description: metas.map((m) => m.label).join(', '),
      })
      onMutated()
    } catch (e) {
      const err = e as ApiError
      toast.error('Could not save changes', { description: err.message })
    } finally {
      setSavingKey(null)
    }
  }

  const secretRows = React.useMemo(() => {
    if (!config) return []
    return [
      { label: 'Discord Bot Token', set: config.DISCORD_TOKEN_SET, description: 'Required — bot cannot start without this' },
      { label: 'Discord Client ID', set: config.CLIENT_ID_SET, description: 'Required — needed for slash-command registration' },
      { label: 'Hypixel API Key', set: config.HYPIXEL_API_KEY_SET, description: 'Recommended — used for AH page fetches & player data' },
      { label: 'Groq API Key', set: config.GROQ_API_KEY_SET, description: 'Optional — powers the AI assistant TTS mode' },
      { label: 'VoiceRSS API Key', set: config.VOICERSS_API_KEY_SET, description: 'Optional — enables VoiceRSS TTS provider' },
    ]
  }, [config])

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 border-b border-border/60 bg-card/50 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-teal-500/10 text-teal-500 ring-1 ring-teal-500/20 dark:text-teal-400">
              <Settings className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                Bot Configuration
              </CardTitle>
              <CardDescription className="text-xs">
                Editable values — overrides are persisted in the bot DB and take precedence over env defaults
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'gap-1 px-2 py-0.5 text-[10px]',
                dirtyKeys.length > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              {dirtyKeys.length > 0 ? `${dirtyKeys.length} unsaved` : 'all saved'}
            </Badge>
            <Button
              size="sm"
              onClick={onSaveAll}
              disabled={dirtyKeys.length === 0 || savingKey !== null}
              className="h-8 gap-1.5 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
            >
              {savingKey === '__all__' ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Save Changes</span>
              <span className="sm:hidden">Save</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {loading && !config && <ConfigSkeleton />}

        {error && !config && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load config</p>
              <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {config && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {/* Editable fields */}
            <section aria-label="Editable flip tracker settings">
              <div className="mb-2 flex items-center gap-2">
                <Hash className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Flip Tracker Settings
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {FIELD_METAS.map((meta) => (
                  <ConfigFieldRow
                    key={meta.key}
                    meta={meta}
                    config={config}
                    draft={drafts[meta.key] ?? ''}
                    onDraft={(v) =>
                      setDrafts((p) => ({ ...p, [meta.key]: v }))
                    }
                    error={errors[meta.key]}
                    isDirty={dirtyKeys.includes(meta.key)}
                    isSaving={savingKey === meta.key || savingKey === '__all__'}
                    isResetting={resettingKey === meta.key}
                    onSave={() => onSaveKey(meta)}
                    onReset={() => onResetKey(meta)}
                  />
                ))}
              </div>
            </section>

            <Separator />

            {/* Read-only secrets */}
            <section aria-label="API keys & secrets">
              <div className="mb-2 flex items-center gap-2">
                <Key className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  API Keys &amp; Secrets
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {secretRows.map((s) => (
                  <SecretItem key={s.label} {...s} />
                ))}
              </div>
            </section>

            <p className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <strong>Source badges</strong>:{' '}
              <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[9px] border-gold-500/40 bg-gold-500/10 text-gold-600 dark:text-gold-400">DB</Badge>{' '}
              = override saved from this dashboard ·{' '}
              <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[9px] border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300">ENV</Badge>{' '}
              = Railway environment variable ·{' '}
              <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[9px] border-muted-foreground/30 bg-muted/40 text-muted-foreground">DEFAULT</Badge>{' '}
              = built-in fallback. Use <strong>Reset</strong> to clear an override and revert to env/default.
            </p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}

interface ConfigFieldRowProps {
  meta: FieldMeta
  config: EditableConfig
  draft: string
  onDraft: (v: string) => void
  error?: string
  isDirty: boolean
  isSaving: boolean
  isResetting: boolean
  onSave: () => void
  onReset: () => void
}

function ConfigFieldRow({
  meta,
  config,
  draft,
  onDraft,
  error,
  isDirty,
  isSaving,
  isResetting,
  onSave,
  onReset,
}: ConfigFieldRowProps) {
  const Icon = meta.icon
  const source: ConfigSource = config.sources?.[meta.key] ?? 'default'
  const sourceStyle = SOURCE_STYLE[source]
  const SourceIcon = sourceStyle.icon
  const liveRaw = config.values?.[meta.key]
  const livePreview = formatPreviewValue(meta, liveRaw ?? null)
  const isOverride = source === 'db'

  return (
    <div
      className={cn(
        'rounded-lg border bg-card/40 p-3 transition-colors',
        error
          ? 'border-destructive/40 bg-destructive/5'
          : isDirty
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-border/40 hover:bg-card/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground">
            <Icon className="size-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-xs font-semibold">{meta.label}</span>
              <code className="hidden rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground sm:inline">
                {meta.envVar}
              </code>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'shrink-0 gap-1 px-1.5 py-0 text-[9px]',
                  sourceStyle.className,
                )}
              >
                <SourceIcon className="size-2.5" aria-hidden="true" />
                {sourceStyle.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p>Source: {source.toUpperCase()}</p>
              <p className="text-muted-foreground">Current value: {livePreview}</p>
              {isOverride && (
                <p className="text-amber-600 dark:text-amber-400">
                  Override saved from dashboard — click Reset to revert
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={placeholderFor(meta, config)}
          inputMode={meta.kind === 'number' ? 'numeric' : 'numeric'}
          aria-label={`${meta.label} value`}
          aria-invalid={!!error}
          className={cn(
            'h-8 flex-1 font-mono text-xs',
            error && 'border-destructive/60 focus-visible:ring-destructive/30',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isDirty && !isSaving) {
              e.preventDefault()
              onSave()
            }
          }}
        />
        {meta.unit === 'coins' && draft && Number(draft) > 0 && (
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            = {formatCoinsFull(Number(draft))} coins
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="h-8 shrink-0 gap-1 px-2 text-[11px]"
          aria-label={`Save ${meta.label}`}
        >
          {isSaving ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3" aria-hidden="true" />
          )}
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          disabled={!isOverride || isResetting}
          className="h-8 shrink-0 gap-1 px-2 text-[11px]"
          aria-label={`Reset ${meta.label} to default`}
        >
          {isResetting ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="size-3" aria-hidden="true" />
          )}
          Reset
        </Button>
      </div>

      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="size-3" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

function SecretItem({
  label,
  set,
  description,
}: {
  label: string
  set: boolean
  description: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        set
          ? 'border-teal-500/30 bg-teal-500/5'
          : 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md',
            set ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400' : 'bg-destructive/15 text-destructive',
          )}
        >
          {set ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <XCircle className="size-3.5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{label}</div>
          <p className="truncate text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 px-1.5 py-0 text-[10px]',
          set
            ? 'border-teal-500/30 text-teal-600 dark:text-teal-400'
            : 'border-destructive/30 text-destructive',
        )}
      >
        {set ? 'Set' : 'Missing'}
      </Badge>
    </div>
  )
}
